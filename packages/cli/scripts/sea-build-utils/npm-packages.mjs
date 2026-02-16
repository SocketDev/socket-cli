/**
 * @fileoverview npm package download utilities for VFS bundling.
 * Downloads npm packages with full dependency trees using Arborist for SEA VFS embedding.
 */

import { existsSync, readFileSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Arborist } from '@npmcli/arborist'

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { normalizePath } from '@socketsecurity/lib/paths/normalize'
import { spawn } from '@socketsecurity/lib/spawn'

import { getRootPath } from './downloads.mjs'

const logger = getDefaultLogger()

/**
 * External tools configuration loaded from external-tools.json.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const externalToolsPath = path.join(__dirname, '../../external-tools.json')
const externalTools = JSON.parse(readFileSync(externalToolsPath, 'utf8'))

/**
 * Get Socket cacache directory for Arborist npm package caching.
 *
 * @returns Path to Socket's cacache directory.
 */
function getSocketCacacheDir() {
  const homeDir = process.env['HOME'] || process.env['USERPROFILE'] || tmpdir()
  return normalizePath(path.join(homeDir, '.socket', '_cacache'))
}

/**
 * Download a single npm package with full dependency tree using Arborist.
 *
 * Downloads the complete package structure including node_modules/ with all
 * production dependencies, ready for VFS bundling.
 *
 * @param {string} packageSpec - npm package specifier (e.g., "synp@1.9.14").
 * @param {string} targetDir - Directory to install package into.
 * @returns Promise resolving to the target directory path.
 *
 * @example
 * await downloadNpmPackage('synp@1.9.14', '/tmp/synp')
 * // Creates: /tmp/synp/node_modules/synp/ with full dependency tree
 */
async function downloadNpmPackage(packageSpec, targetDir) {
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

  logger.success(`${packageSpec} installed with dependencies\n`)
  return targetDir
}

/**
 * Download all npm packages with full dependency trees for VFS bundling.
 *
 * Downloads npm packages specified in external-tools.json that have type='npm',
 * installs them with full production dependency trees using Arborist, and packages
 * them into a compressed tar.gz for VFS embedding.
 *
 * npm Packages:
 * - @coana-tech/cli: Static analysis and reachability detection.
 * - @cyclonedx/cdxgen: CycloneDX SBOM generator.
 * - @socketsecurity/socket-patch: Security patch CLI.
 * - synp: yarn.lock to package-lock.json converter.
 *
 * Directory Structure:
 * <targetDir>/
 *   └── node_modules/
 *       ├── @coana-tech/cli/
 *       │   ├── bin/coana
 *       │   ├── package.json
 *       │   └── node_modules/  # Dependencies
 *       ├── @cyclonedx/cdxgen/
 *       │   ├── bin/cdxgen
 *       │   ├── package.json
 *       │   └── node_modules/  # Dependencies
 *       ├── @socketsecurity/socket-patch/
 *       │   ├── bin/socket-patch
 *       │   ├── package.json
 *       │   └── node_modules/  # Dependencies
 *       └── synp/
 *           ├── bin/synp
 *           ├── package.json
 *           └── node_modules/  # Dependencies
 *
 * @returns Promise resolving to path of tar.gz archive, or null if no npm packages defined.
 *
 * @example
 * const tarGzPath = await downloadNpmPackages()
 * // Returns: '../build-infra/build/npm-packages/npm-packages.tar.gz'
 */
export async function downloadNpmPackages() {
  const rootPath = getRootPath()
  const npmPackagesDir = normalizePath(
    path.join(rootPath, '../build-infra/build/npm-packages'),
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
        `Cached npm packages tar.gz is too small (${stats.size} bytes), rebuilding...`,
      )
      await safeDelete(tarGzPath)
    } else {
      logger.log(`npm packages tar.gz already exists: ${tarGzPath}`)
      return tarGzPath
    }
  }

  // Collect npm packages from external-tools.json.
  const npmPackages = []
  for (const [toolName, toolConfig] of Object.entries(externalTools)) {
    if (toolConfig.type === 'npm') {
      npmPackages.push({
        name: toolName,
        package: toolConfig.package,
        version: toolConfig.version,
      })
    }
  }

  if (npmPackages.length === 0) {
    logger.warn('No npm packages defined in external-tools.json')
    return null
  }

  logger.step('Downloading npm packages with full dependency trees')
  await safeMkdir(npmPackagesDir)

  // Create unique temporary directory for package installation (prevents parallel build conflicts).
  const tempDir = normalizePath(
    path.join(npmPackagesDir, `temp-${process.pid}-${Date.now()}`),
  )
  await safeMkdir(tempDir)

  try {
    // Download all npm packages with dependencies using Arborist.
    for (const pkg of npmPackages) {
      const packageSpec = `${pkg.package}@${pkg.version}`
      await downloadNpmPackage(packageSpec, tempDir)
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

    if (tarResult && tarResult.exitCode !== 0) {
      throw new Error('Failed to create npm packages tar.gz')
    }

    const tarStats = await fs.stat(tarGzPath)
    logger.success(
      `npm packages packaged: ${(tarStats.size / 1_024 / 1_024).toFixed(2)} MB\n`,
    )

    return tarGzPath
  } finally {
    // Clean up temporary directory.
    await safeDelete(tempDir)
  }
}

/**
 * Combine npm packages and security tools into a single VFS archive.
 *
 * Creates a unified tar.gz containing both:
 * - node_modules/ with npm packages and dependencies.
 * - Security tool binaries (Python, Trivy, TruffleHog, OpenGrep).
 *
 * The combined archive is used by binject for VFS embedding into SEA binaries.
 *
 * Directory structure in combined archive:
 * ./node_modules/                    # npm packages with dependencies
 *   ├── @coana-tech/cli/
 *   ├── @cyclonedx/cdxgen/
 *   ├── @socketsecurity/socket-patch/
 *   └── synp/
 * ./python/                          # Python runtime
 * ./trivy                            # Trivy binary
 * ./trufflehog                       # TruffleHog binary
 * ./opengrep                         # OpenGrep binary
 *
 * @param {string} npmPackagesTarGz - Path to npm packages tar.gz.
 * @param {string} securityToolsTarGz - Path to security tools tar.gz.
 * @param {string} platform - Platform identifier (darwin, linux, win32).
 * @param {string} arch - Architecture identifier (arm64, x64).
 * @param {boolean} [isMusl=false] - Whether this is musl libc (Linux only).
 * @returns Promise resolving to path of combined tar.gz.
 *
 * @example
 * const combined = await combineVfsArchives(
 *   '../build-infra/build/npm-packages/npm-packages.tar.gz',
 *   '../build-infra/build/security-tools/darwin-arm64.tar.gz',
 *   'darwin',
 *   'arm64'
 * )
 * // Returns: '../build-infra/build/vfs/darwin-arm64.tar.gz'
 */
export async function combineVfsArchives(
  npmPackagesTarGz,
  securityToolsTarGz,
  platform,
  arch,
  isMusl = false,
) {
  const rootPath = getRootPath()
  const muslSuffix = isMusl ? '-musl' : ''
  const platformArch = `${platform}-${arch}${muslSuffix}`

  const vfsDir = normalizePath(
    path.join(rootPath, `../build-infra/build/vfs/${platformArch}`),
  )
  const combinedTarGz = normalizePath(
    path.join(rootPath, `../build-infra/build/vfs/${platformArch}.tar.gz`),
  )

  // Check if combined tar.gz already exists and is valid.
  if (existsSync(combinedTarGz)) {
    const stats = await fs.stat(combinedTarGz)

    // Validate cached file is not empty or suspiciously small (> 1KB).
    if (stats.size < 1024) {
      logger.warn(
        `Cached combined VFS tar.gz is too small (${stats.size} bytes), rebuilding...`,
      )
      await safeDelete(combinedTarGz)
    } else {
      logger.log(`Combined VFS tar.gz already exists: ${combinedTarGz}`)
      return combinedTarGz
    }
  }

  logger.step('Combining npm packages and security tools into VFS archive')

  // Create temporary directory for extraction and combination.
  await safeMkdir(vfsDir)

  try {
    // Extract npm packages tar.gz.
    if (npmPackagesTarGz && existsSync(npmPackagesTarGz)) {
      logger.substep('Extracting npm packages')
      const tarResult = await spawn('tar', ['-xzf', npmPackagesTarGz, '-C', vfsDir])
      if (tarResult && tarResult.exitCode !== 0) {
        throw new Error('Failed to extract npm packages tar.gz')
      }
    }

    // Extract security tools tar.gz.
    if (securityToolsTarGz && existsSync(securityToolsTarGz)) {
      logger.substep('Extracting security tools')
      const tarResult = await spawn('tar', [
        '-xzf',
        securityToolsTarGz,
        '-C',
        vfsDir,
      ])
      if (tarResult && tarResult.exitCode !== 0) {
        throw new Error('Failed to extract security tools tar.gz')
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

    if (tarResult && tarResult.exitCode !== 0) {
      throw new Error('Failed to create combined VFS tar.gz')
    }

    const tarStats = await fs.stat(combinedTarGz)
    logger.success(
      `Combined VFS archive: ${(tarStats.size / 1_024 / 1_024).toFixed(2)} MB\n`,
    )

    return combinedTarGz
  } finally {
    // Clean up extracted files.
    await safeDelete(vfsDir)
  }
}
