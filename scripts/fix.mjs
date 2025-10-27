/**
 * @fileoverview Monorepo-aware auto-fix script - runs linters with auto-fix enabled.
 * Delegates to lint.mjs with --fix flag.
 *
 * Usage:
 *   node scripts/fix.mjs [options]
 *
 * Options:
 *   --all      Fix all packages
 *   --changed  Fix packages with changed files (default)
 *   --quiet    Suppress progress output
 *   --staged   Fix packages with staged files
 *   --verbose  Show detailed output
 */

import { isQuiet } from '@socketsecurity/lib/argv/flags'
import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { logger } from '@socketsecurity/lib/logger'
import { printHeader } from '@socketsecurity/lib/stdio/header'

import { runCommand } from './utils/run-command.mjs'

async function main() {
  const { values } = parseArgs({
    options: {
      all: { type: 'boolean', default: false },
      changed: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
      silent: { type: 'boolean', default: false },
      staged: { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
    },
    strict: false,
  })

  const quiet = isQuiet(values)
  const verbose = values.verbose

  try {
    if (!quiet) {
      printHeader('Running Auto-fix')
      logger.log()
    }

    // Build lint command arguments.
    const lintArgs = ['run', 'lint', '--fix']
    if (values.all) {
      lintArgs.push('--all')
    }
    if (values.changed) {
      lintArgs.push('--changed')
    }
    if (values.staged) {
      lintArgs.push('--staged')
    }
    if (quiet) {
      lintArgs.push('--quiet')
    }

    // Run lint with --fix flag.
    const exitCode = await runCommand('pnpm', lintArgs, {
      stdio: quiet ? 'pipe' : 'inherit',
    })

    if (exitCode !== 0) {
      if (!quiet) {
        logger.error('Some fixes could not be applied')
      }
      process.exitCode = 1
    } else {
      if (!quiet) {
        logger.log()
        logger.success('Auto-fix completed!')
      }
    }
  } catch (error) {
    if (!quiet) {
      logger.error(`Fix failed: ${error.message}`)
    }
    if (verbose) {
      logger.error(error)
    }
    process.exitCode = 1
  }
}

main().catch(e => {
  logger.error(e)
  process.exitCode = 1
})
