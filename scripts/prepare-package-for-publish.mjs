/**
 * @fileoverview Helper script to prepare package.json for publishing.
 * Handles removing private field and optionally setting version.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

const args = process.argv.slice(2)
const packagePath = args[0]
const version = args[1]

if (!packagePath) {
  logger.error(
    'Usage: prepare-package-for-publish.mjs <package-path> [version]',
  )
  process.exitCode = 1
} else {
  const pkgPath = resolve(packagePath, 'package.json')

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))

    // Remove private field.
    delete pkg.private

    // Set version if provided.
    if (version) {
      pkg.version = version
      logger.log(`Set ${pkg.name} version to ${version}`)
    }

    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
    logger.success(`Prepared ${pkg.name} for publishing`)
  } catch (error) {
    logger.error(`Error preparing package: ${error.message}`)
    process.exitCode = 1
  }
}
