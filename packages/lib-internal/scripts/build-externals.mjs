/**
 * @fileoverview Bundle external dependencies into standalone zero-dependency modules.
 * This bundles packages like cacache, pacote, make-fetch-happen into dist/external.
 *
 * Entry point that wraps the modular build-externals system.
 */

import colors from 'yoctocolors-cjs'

import { isQuiet } from '#socketsecurity/lib/argv/flags'
import { getDefaultLogger } from '#socketsecurity/lib/logger'
import { pluralize } from '#socketsecurity/lib/words'

import { buildExternals } from './build-externals/orchestrator.mjs'

const logger = getDefaultLogger()
const printCompletedHeader = title => console.log(colors.green(`✓ ${title}`))

async function main() {
  // Check for verbose mode via isVerbose or manual check
  const verbose = process.argv.includes('--verbose')
  const quiet = isQuiet()

  try {
    const { bundledCount } = await buildExternals({ verbose, quiet })

    if (!quiet) {
      const title =
        bundledCount > 0
          ? `External Bundles (${bundledCount} ${pluralize('package', { count: bundledCount })})`
          : 'External Bundles (no packages)'
      printCompletedHeader(title)
    }
  } catch (error) {
    logger.error(`Build failed: ${error.message || error}`)
    process.exitCode = 1
  }
}

main().catch(error => {
  logger.error(`Build failed: ${error.message || error}`)
  process.exitCode = 1
})
