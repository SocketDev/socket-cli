/**
 * Generate CLI package directories from templates.
 * Creates both the standard CLI and CLI-with-Sentry packages.
 *
 * Usage:
 *   node scripts/generate-cli-packages.mjs
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { copyDirectory } from './utils.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const generatePath = path.join(__dirname, '..')
const logger = getDefaultLogger()

/**
 * Package configurations.
 */
const PACKAGES = [
  {
    name: '@socketsecurity/cli',
    templateDir: 'cli-package',
    outputDir: 'cli',
  },
  {
    name: '@socketsecurity/cli-with-sentry',
    templateDir: 'cli-sentry-package',
    outputDir: 'cli-with-sentry',
  },
]

/**
 * Main generation logic.
 */
async function main() {
  logger.log('')
  logger.log('Generating CLI packages from templates...')
  logger.log('='.repeat(50))
  logger.log('')

  for (const pkg of PACKAGES) {
    const templatePath = path.join(generatePath, 'templates', pkg.templateDir)
    const packagePath = path.join(generatePath, 'build', pkg.outputDir)

    // Copy entire template directory.
    await copyDirectory(templatePath, packagePath)

    logger.success(`Generated ${pkg.name} package`)
  }

  logger.log('')
}

main().catch(e => {
  logger.error('Package generation failed:', e)
  process.exitCode = 1
})
