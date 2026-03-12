/**
 * @fileoverview Prepares @socketbin/* binary packages for publishing.
 * Updates package.json with version and buildMethod, removes private field.
 * Binary is already in place from SEA build (following biome convention).
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import {
  getSocketbinBinaryPath,
  getSocketbinPackageDir,
} from 'package-builder/scripts/paths.mjs'

const logger = getDefaultLogger()

/**
 * Generates a datetime-based version string in semver format.
 * Reads base version from the current package's package.json.
 * Format: X.Y.Z-YYYYMMDD.HHmmss
 */
function generateDatetimeVersion(platform, arch, libc) {
  // Read base version from the current package being generated.
  const packageDir = getSocketbinPackageDir(platform, arch, libc)
  const basePackagePath = path.join(packageDir, 'package.json')
  let baseVersion = '0.0.0'

  try {
    const basePackage = JSON.parse(
      require('node:fs').readFileSync(basePackagePath, 'utf-8'),
    )
    const version = basePackage.version || '0.0.0'
    // Extract just the core version (X.Y.Z), ignoring any prerelease/placeholder text.
    const versionMatch = version.match(/^(\d+\.\d+\.\d+)/)
    if (versionMatch) {
      baseVersion = versionMatch[1]
    }
  } catch {
    // Fallback to 0.0.0 if package doesn't exist yet.
  }

  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  const seconds = String(now.getSeconds()).padStart(2, '0')
  return `${baseVersion}-${year}${month}${day}.${hours}${minutes}${seconds}`
}

const { values } = parseArgs({
  options: {
    arch: { type: 'string' },
    dev: { type: 'boolean' },
    libc: { type: 'string' },
    method: { default: 'smol', type: 'string' },
    platform: { type: 'string' },
    prod: { type: 'boolean' },
    version: { type: 'string' },
  },
})

const {
  arch,
  libc,
  method: buildMethod = 'smol',
  platform,
  version: providedVersion,
} = values

if (!platform || !arch) {
  logger.error(
    'Usage: prepublish-socketbin.mjs --platform=darwin --arch=arm64 [--version=0.0.0-20250122.143052] [--method=smol]',
  )
  process.exitCode = 1
}

// Clean version (remove 'v' prefix if present) or generate if not provided.
const cleanVersion = providedVersion
  ? providedVersion.replace(/^v/, '')
  : generateDatetimeVersion(platform, arch, libc)

// Get package directory from centralized paths.
const packageDir = getSocketbinPackageDir(platform, arch, libc)

// Update package for publishing.
async function generatePackage() {
  try {
    // Verify binary exists (should be built by SEA build).
    const binaryPath = getSocketbinBinaryPath(platform, arch, libc)
    if (!existsSync(binaryPath)) {
      logger.error(`Binary not found at ${binaryPath}`)
      logger.error('Run SEA build first: pnpm run build:sea')
      process.exitCode = 1
      return
    }

    // Read existing package.json.
    const pkgPath = path.join(packageDir, 'package.json')
    const existingPkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'))

    // Update package.json with new version, buildMethod, and remove private.
    const updatedPkg = {
      ...existingPkg,
      buildMethod,
      version: cleanVersion,
    }
    delete updatedPkg.private

    // Write updated package.json.
    await fs.writeFile(pkgPath, `${JSON.stringify(updatedPkg, null, 2)}\n`)
    logger.log(`Updated: ${pkgPath}`)
    logger.log(`  Version: ${cleanVersion}`)
    logger.log(`  Build method: ${buildMethod}`)
    logger.log(`  Binary: ${binaryPath}`)

    logger.log(`\nPackage ready for publishing at: ${packageDir}`)
    logger.log(
      `\nTo publish:\n  cd ${packageDir}\n  npm publish --provenance --access public`,
    )
  } catch (e) {
    logger.error('Error generating package:', e)
    process.exitCode = 1
  }
}

if (!process.exitCode) {
  generatePackage()
}
