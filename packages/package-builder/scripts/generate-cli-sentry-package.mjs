/**
 * Generate cli-with-sentry package directory from template.
 * Creates the @socketsecurity/cli-with-sentry package that will be used
 * for publishing the CLI with Sentry telemetry integration.
 *
 * Usage:
 *   node scripts/generate-cli-sentry-package.mjs
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { copyDirectory } from './utils.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const generatePath = path.join(__dirname, '..')
const logger = getDefaultLogger()

/**
 * Main generation logic.
 */
async function main() {
  logger.log('')
  logger.log('Generating cli-with-sentry package from template...')
  logger.log('='.repeat(50))
  logger.log('')

  const templatePath = path.join(generatePath, 'templates/cli-sentry-package')
  const packagePath = path.join(generatePath, 'build/cli-with-sentry')

  // Copy entire template directory.
  await copyDirectory(templatePath, packagePath)

  logger.success('Generated @socketsecurity/cli-with-sentry package')
  logger.log('')
}

main().catch(e => {
  logger.error('Package generation failed:', e)
  process.exit(1)
})
