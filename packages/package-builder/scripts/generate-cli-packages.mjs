/**
 * Generate CLI package directories from templates.
 * Creates both the standard CLI and CLI-with-Sentry packages.
 *
 * Usage:
 *   node scripts/generate-cli-packages.mjs
 */

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import {
  CLI_SENTRY_TEMPLATE_DIR,
  CLI_TEMPLATE_DIR,
  SOCKET_TEMPLATE_DIR,
  getPackageOutDir,
} from './paths.mjs'
import { copyDirectory } from './utils.mjs'

const logger = getDefaultLogger()

/**
 * Package configurations.
 */
const PACKAGES = [
  {
    name: '@socketsecurity/cli',
    outputDir: 'cli',
    templateDir: CLI_TEMPLATE_DIR,
  },
  {
    name: '@socketsecurity/cli-with-sentry',
    outputDir: 'cli-with-sentry',
    templateDir: CLI_SENTRY_TEMPLATE_DIR,
  },
  {
    name: 'socket',
    outputDir: 'socket',
    templateDir: SOCKET_TEMPLATE_DIR,
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
    const packagePath = getPackageOutDir(pkg.outputDir)

    // Copy entire template directory.
    await copyDirectory(pkg.templateDir, packagePath)

    logger.success(`Generated ${pkg.name} package`)
  }

  logger.log('')
}

main().catch(e => {
  logger.error('Package generation failed:', e)
  process.exitCode = 1
})
