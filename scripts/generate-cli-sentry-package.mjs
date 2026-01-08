/**
 * Generate cli-with-sentry package directory from template.
 * Creates the @socketsecurity/cli-with-sentry package that will be used
 * for publishing the CLI with Sentry telemetry integration.
 *
 * Usage:
 *   node scripts/generate-cli-sentry-package.mjs
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')
const logger = getDefaultLogger()

/**
 * Copy directory recursively.
 */
async function copyDirectory(src, dest) {
  await fs.cp(src, dest, { recursive: true })
}

/**
 * Main generation logic.
 */
async function main() {
  logger.log('')
  logger.log('Generating cli-with-sentry package from template...')
  logger.log('='.repeat(50))
  logger.log('')

  const templatePath = path.join(rootPath, 'templates/cli-sentry-package')
  const packagePath = path.join(rootPath, 'generated-packages/cli-with-sentry')

  // Copy entire template directory.
  await copyDirectory(templatePath, packagePath)

  logger.success('Generated @socketsecurity/cli-with-sentry package')
  logger.log('')
}

main().catch(e => {
  logger.error('Package generation failed:', e)
  process.exit(1)
})
