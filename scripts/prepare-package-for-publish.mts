/**
 * @fileoverview Helper script to prepare package.json for publishing.
 * Handles removing private field and optionally setting version.
 */

import { resolve } from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { preparePackageForPublish } from 'package-builder/scripts/utils/prepare-package.mjs'

const logger = getDefaultLogger()

const args = process.argv.slice(2)
const packagePath: string | undefined = args[0]
const version: string | undefined = args[1]

if (!packagePath) {
  logger.error(
    'Usage: prepare-package-for-publish.mjs <package-path> [version]',
  )
  process.exitCode = 1
} else {
  try {
    preparePackageForPublish(resolve(packagePath), { version })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logger.error(`Error preparing package: ${message}`)
    process.exitCode = 1
  }
}
