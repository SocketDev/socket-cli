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
 * - Updates optionalDependencies versions (for lockstep publishing)
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

    // Update optionalDependencies to use the same version (lockstep).
    if (pkg.optionalDependencies) {
      for (const dep of Object.keys(pkg.optionalDependencies)) {
        pkg.optionalDependencies[dep] = version
      }
    }
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
