/**
 * @fileoverview Unified auto-fix script - runs linters with auto-fix enabled.
 * Standardized across all socket-* repositories.
 *
 * Usage:
 *   node scripts/fix.mjs [options]
 *
 * Options:
 *   --all      Fix all files (skip file filtering)
 *   --changed  Fix changed files (default behavior)
 *   --quiet    Suppress progress output
 *   --staged   Fix staged files
 *   --verbose  Show detailed output
 */

import { isQuiet } from '@socketsecurity/lib/argv/flags'
import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'
import { printHeader } from '@socketsecurity/lib/stdio/header'

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
      getDefaultLogger().log('')
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

    // Run lint with --fix flag.
    const result = await spawn('pnpm', lintArgs, {
      shell: WIN32,
      stdio: quiet ? 'pipe' : 'inherit',
    })

    if (result.code !== 0) {
      if (!quiet) {
        getDefaultLogger().error('Some fixes could not be applied')
      }
      process.exitCode = 1
    } else {
      if (!quiet) {
        getDefaultLogger().log('')
        getDefaultLogger().success('Auto-fix completed!')
      }
    }
  } catch (error) {
    if (!quiet) {
      getDefaultLogger().error(`Fix failed: ${error.message}`)
    }
    if (verbose) {
      getDefaultLogger().error(error)
    }
    process.exitCode = 1
  }
}

main().catch(e => {
  getDefaultLogger().error(e)
  process.exitCode = 1
})
