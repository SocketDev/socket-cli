/**
 * @fileoverview Unified auto-fix script - runs linters with auto-fix enabled.
 * Standardized across all socket-* repositories.
 *
 * Usage:
 *   node scripts/fix.mjs [options]
 *
 * Options:
 *   --quiet    Suppress progress output
 *   --verbose  Show detailed output
 */

import { isQuiet } from '@socketsecurity/registry/lib/argv/flags'
import { parseArgs } from '@socketsecurity/registry/lib/argv/parse'
import { logger } from '@socketsecurity/registry/lib/logger'
import { printHeader } from '@socketsecurity/registry/lib/stdio/header'

import { runCommand } from './utils/run-command.mjs'

async function main() {
  const { values } = parseArgs({
    options: {
      quiet: { type: 'boolean', default: false },
      silent: { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
    },
    strict: false,
  })

  const quiet = isQuiet(values)
  const verbose = values.verbose

  try {
    if (!quiet) {
      printHeader('Running Auto-fix')
      console.log()
    }

    // Run lint with --fix flag
    const exitCode = await runCommand('pnpm', ['run', 'lint', '--fix'], {
      stdio: quiet ? 'pipe' : 'inherit',
    })

    if (exitCode !== 0) {
      if (!quiet) {
        logger.error('Some fixes could not be applied')
      }
      process.exitCode = 1
    } else {
      if (!quiet) {
        console.log()
        logger.success('Auto-fix completed!')
      }
    }
  } catch (error) {
    if (!quiet) {
      logger.error(`Fix failed: ${error.message}`)
    }
    if (verbose) {
      console.error(error)
    }
    process.exitCode = 1
  }
}

main().catch(console.error)
