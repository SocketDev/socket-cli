/**
 * @file Npm package download utilities for VFS bundling. Downloads npm packages
 *   with full dependency trees using Arborist for SEA VFS embedding.
 */

// oxlint-disable-next-line socket/no-file-scope-oxlint-disable -- legitimate file-scope: fs.stat() reads .size, not existence; per-call would produce many redundant disables.
// oxlint-disable socket/prefer-exists-sync -- fs.stat() calls read .size for cache validation and reporting; not existence checks.

import { existsSync, promises as fs, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Arborist } from '@npmcli/arborist'

import { safeDelete, safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { getRootPath } from './downloads.mts'
import {
  assertInstalledMatchesPin,
  collectNpmToolPins,
} from './npm-integrity.mts'

const logger = getDefaultLogger()

/**
 * External tools configuration loaded from bundle-tools.json.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const externalToolsPath = path.join(__dirname, '../../bundle-tools.json')
// Entries live under the `tools` key, the shared external-tools shape.
const externalTools = JSON.parse(readFileSync(externalToolsPath, 'utf8')).tools

/**
 * Combine npm packages and external tools into a single VFS archive.
 *
 * Writes one tar.gz holding `node_modules/` — the npm packages plus their
 * production dependencies — alongside the external tool payloads at the archive
 * root: `python/` (the runtime directory), and the `trivy`, `trufflehog`,
 * `opengrep`, and `socket-patch` binaries. binject reads this archive to embed
 * the VFS into a SEA binary.
 *
 * @param {string} npmPackagesTarGz - Path to npm packages tar.gz.
 * @param {string} externalToolsTarGz - Path to external tools tar.gz.
 * @param {string} platform - Platform identifier (darwin, linux, win32).
 * @param {string} arch - Architecture identifier (arm64, x64).
 * @param {boolean} [isMusl=false] - Whether this is musl libc, Linux only.
 *
 * @returns Promise resolving to the combined tar.gz path, `<vfsDir>/
 *   <platform>-<arch>.tar.gz`.
 */
async function combineVfsArchives(
  npmPackagesTarGz,
  externalToolsTarGz,
  platform,
  arch,
  isMusl = false,
) {
  const rootPath = getRootPath()
  const muslSuffix = isMusl ? '-musl' : ''
  const platformArch = `${platform}-${arch}${muslSuffix}`

  const vfsDir = normalizePath(
    path.join(rootPath, `packages/build-infra/build/vfs/${platformArch}`),
  )
  const combinedTarGz = normalizePath(
    path.join(
      rootPath,
      `packages/build-infra/build/vfs/${platformArch}.tar.gz`,
    ),
  )

  // Check if combined tar.gz already exists and is valid.
  if (existsSync(combinedTarGz)) {
    const stats = await fs.stat(combinedTarGz)

    // Validate cached file is not empty or suspiciously small (> 1KB).
    if (stats.size < 1024) {
      logger.warn(
        `Cached combined VFS tar.gz is too small (${stats.size} bytes), rebuilding…`,
      )
      await safeDelete(combinedTarGz)
    } else {
      logger.log(`Combined VFS tar.gz already exists: ${combinedTarGz}`)
      return combinedTarGz
    }
  }

  logger.step('Combining npm packages and external tools into VFS archive')

  // Create temporary directory for extraction and combination.
  await safeMkdir(vfsDir)

  try {
    // Extract npm packages tar.gz.
    if (npmPackagesTarGz && existsSync(npmPackagesTarGz)) {
      logger.substep('Extracting npm packages')
      const tarResult = await spawn('tar', [
        '-xzf',
        npmPackagesTarGz,
        '-C',
        vfsDir,
      ])
      if (tarResult && tarResult.code !== 0) {
        throw new Error('Failed to extract npm packages tar.gz')
      }
    }

    // Extract external tools tar.gz.
    if (externalToolsTarGz && existsSync(externalToolsTarGz)) {
      logger.substep('Extracting external tools')
      const tarResult = await spawn('tar', [
        '-xzf',
        externalToolsTarGz,
        '-C',
        vfsDir,
      ])
      if (tarResult && tarResult.code !== 0) {
        throw new Error('Failed to extract external tools tar.gz')
      }
    }

    // List contents for combined archive.
    const contents = await fs.readdir(vfsDir)
    if (contents.length === 0) {
      throw new Error('No files to package in VFS directory')
    }

    // Create combined tar.gz.
    logger.substep('Creating combined tar.gz')
    const tarResult = await spawn('tar', [
      '-czf',
      combinedTarGz,
      '-C',
      vfsDir,
      ...contents,
    ])

    if (tarResult && tarResult.code !== 0) {
      throw new Error('Failed to create combined VFS tar.gz')
    }

    const tarStats = await fs.stat(combinedTarGz)
    logger.success(
      `Combined VFS archive: ${(tarStats.size / 1024 / 1024).toFixed(2)} MB`,
    )
    logger.error('')

    return combinedTarGz
  } finally {
    // Clean up extracted files.
    await safeDelete(vfsDir)
  }
}

/**
 * Download a single npm package with full dependency tree using Arborist.
 *
 * Installs into `<targetDir>/node_modules/<name>/` with all production
 * dependencies, ready for VFS bundling, then checks the result against the
 * tool's `integrity` pin. A missing or mismatched pin throws — see
 * npm-integrity.mts for why both the npm-recorded hash and our pin are needed.
 *
 * @param {object} pin - The npm tool as declared in bundle-tools.json.
 * @param {string} targetDir - Directory to install package into.
 *
 * @returns Promise resolving to the target directory path.
 */
async function downloadNpmPackage(pin, targetDir) {
  const packageSpec = `${pin.name}@${pin.version}`
  logger.substep(`Downloading ${packageSpec} with dependencies`)

  // Ensure target directory exists.
  await safeMkdir(targetDir)

  // Configure Arborist with Socket cacache and security settings.
  const arb = new Arborist({
    audit: false,
    binLinks: true,
    cache: getSocketCacacheDir(),
    fund: false,
    ignoreScripts: true,
    omit: ['dev'],
    path: targetDir,
    silent: true,
  })

  // Download and install package with dependencies.
  try {
    await arb.reify({ add: [packageSpec], save: false })
  } catch (e) {
    throw new Error(
      `Failed to download ${packageSpec} with Arborist: ${e.message}`,
    )
  }

  // Compare what npm actually installed against the pin. npm writes the hidden
  // lockfile during reify, recording the integrity it verified per package.
  const lockfilePath = path.join(
    targetDir,
    'node_modules',
    '.package-lock.json',
  )
  if (!existsSync(lockfilePath)) {
    throw new Error(
      `Cannot verify integrity for npm tool "${pin.name}": npm wrote no hidden lockfile.\n` +
        `  Where: ${lockfilePath}\n` +
        `  Saw: the file does not exist after Arborist reify.\n` +
        `  Wanted: the lockfile npm writes recording each installed package's integrity.\n` +
        `  Fix: clear ${targetDir} and rerun; an install that records no hash cannot be pinned.`,
    )
  }
  assertInstalledMatchesPin(
    pin,
    JSON.parse(readFileSync(lockfilePath, 'utf8')),
    lockfilePath,
  )
  logger.substep(`Verified ${packageSpec} against its integrity pin`)

  logger.success(`${packageSpec} installed with dependencies`)
  logger.error('')
  return targetDir
}

/**
 * Download all npm packages with full dependency trees for VFS bundling.
 *
 * Installs every `type='npm'` entry in bundle-tools.json with its full
 * production dependency tree via Arborist, then packs the result into one
 * tar.gz for VFS embedding. Today that is @coana-tech/cli (static analysis and
 * reachability), @cyclonedx/cdxgen (CycloneDX SBOM generation), and synp
 * (yarn.lock to package-lock.json).
 *
 * Each package keeps its normal layout under `<targetDir>/node_modules/`: its
 * own `bin/`, its `package.json`, and a nested `node_modules/` for its
 * dependencies. socket-patch is NOT here — it ships as a standalone Rust
 * binary from GitHub releases, handled by downloads.mts.
 *
 * @returns Promise resolving to the tar.gz path, `<npmPackagesDir>/
 *   npm-packages.tar.gz`, or null when no npm packages are defined.
 */
async function downloadNpmPackages() {
  const rootPath = getRootPath()
  const npmPackagesDir = normalizePath(
    path.join(rootPath, 'packages/build-infra/build/npm-packages'),
  )
  const tarGzPath = normalizePath(
    path.join(npmPackagesDir, 'npm-packages.tar.gz'),
  )

  // Check if tar.gz already exists and is valid.
  if (existsSync(tarGzPath)) {
    const stats = await fs.stat(tarGzPath)

    // Validate cached file is not empty or suspiciously small (> 1KB).
    if (stats.size < 1024) {
      logger.warn(
        `Cached npm packages tar.gz is too small (${stats.size} bytes), rebuilding…`,
      )
      await safeDelete(tarGzPath)
    } else {
      logger.log(`npm packages tar.gz already exists: ${tarGzPath}`)
      return tarGzPath
    }
  }

  // Collect npm packages from bundle-tools.json.
  const npmPackages = collectNpmToolPins(externalTools)

  if (npmPackages.length === 0) {
    logger.warn('No npm packages defined in bundle-tools.json')
    return undefined
  }

  logger.step('Downloading npm packages with full dependency trees')
  await safeMkdir(npmPackagesDir)

  // Create unique temporary directory for package installation, prevents parallel build conflicts.
  const tempDir = normalizePath(
    path.join(npmPackagesDir, `temp-${process.pid}-${Date.now()}`),
  )
  await safeMkdir(tempDir)

  try {
    // Download all npm packages with dependencies using Arborist.
    for (let i = 0, { length } = npmPackages; i < length; i += 1) {
      await downloadNpmPackage(npmPackages[i], tempDir)
    }

    // Verify node_modules directory exists and has content.
    const nodeModulesDir = path.join(tempDir, 'node_modules')
    if (!existsSync(nodeModulesDir)) {
      throw new Error('node_modules directory not created by Arborist')
    }

    // Package node_modules into compressed tar.gz.
    logger.substep(`Creating compressed tar.gz: ${path.basename(tarGzPath)}`)
    const tarResult = await spawn('tar', [
      '-czf',
      tarGzPath,
      '-C',
      tempDir,
      'node_modules',
    ])

    if (tarResult && tarResult.code !== 0) {
      throw new Error('Failed to create npm packages tar.gz')
    }

    const tarStats = await fs.stat(tarGzPath)
    logger.success(
      `npm packages packaged: ${(tarStats.size / 1024 / 1024).toFixed(2)} MB`,
    )
    logger.error('')

    return tarGzPath
  } finally {
    // Clean up temporary directory.
    await safeDelete(tempDir)
  }
}

/**
 * Get Socket cacache directory for Arborist npm package caching.
 *
 * @returns Path to Socket's cacache directory.
 */
export function getSocketCacacheDir() {
  const homeDir =
    process.env['HOME'] || process.env['USERPROFILE'] || os.tmpdir()
  return normalizePath(path.join(homeDir, '.socket', '_cacache'))
}
