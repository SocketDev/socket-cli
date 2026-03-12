/**
 * Shared utilities for preparing packages for publishing.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

/**
 * Prepares a package.json for publishing.
 * - Removes private field
 * - Sets version if provided
 * - Sets buildMethod if provided
 *
 * @param {string} packageDir - Path to the package directory
 * @param {object} [options] - Options
 * @param {string} [options.version] - Version to set
 * @param {string} [options.buildMethod] - Build method to set (for socketbin packages)
 * @param {boolean} [options.quiet] - Suppress success logging
 * @returns {{ name: string, version: string }} Package info
 */
export function preparePackageForPublish(packageDir, options = {}) {
  const { buildMethod, quiet, version } = options
  const pkgPath = join(packageDir, 'package.json')

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
  const originalVersion = pkg.version

  // Remove private field.
  delete pkg.private

  // Set version if provided.
  if (version) {
    pkg.version = version
  }

  // Set buildMethod if provided (for socketbin packages).
  if (buildMethod) {
    pkg.buildMethod = buildMethod
  }

  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

  if (!quiet) {
    if (version && version !== originalVersion) {
      logger.log(`Set ${pkg.name} version to ${version}`)
    }
    logger.success(`Prepared ${pkg.name} for publishing`)
  }

  return { name: pkg.name, version: pkg.version }
}

/**
 * Generates a datetime-based version string in semver format.
 * Format: X.Y.Z-YYYYMMDD.HHmmss
 *
 * @param {string} [baseVersion='0.0.0'] - Base semver version (X.Y.Z)
 * @returns {string} Version with datetime suffix
 */
export function generateDatetimeVersion(baseVersion = '0.0.0') {
  // Extract just the core version (X.Y.Z), ignoring any prerelease text.
  const versionMatch = baseVersion.match(/^(\d+\.\d+\.\d+)/)
  const cleanBase = versionMatch ? versionMatch[1] : '0.0.0'

  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  const seconds = String(now.getSeconds()).padStart(2, '0')

  return `${cleanBase}-${year}${month}${day}.${hours}${minutes}${seconds}`
}

/**
 * Reads the base version from a package.json file.
 *
 * @param {string} packageDir - Path to the package directory
 * @returns {string} Base version (defaults to '0.0.0' if not found)
 */
export function readBaseVersion(packageDir) {
  try {
    const pkgPath = join(packageDir, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    return pkg.version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}
