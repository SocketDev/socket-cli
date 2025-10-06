/**
 * @fileoverview Test execution coordination and test filtering logic.
 * Provides utilities for determining which tests to run based on changes.
 */

import { parseArgs } from '@socketsecurity/registry/lib/parse-args'

let _cliArgs

/**
 * Parse and cache command line arguments.
 */
function getCliArgs() {
  if (_cliArgs === undefined) {
    const { values } = parseArgs({
      options: {
        force: {
          type: 'boolean',
          short: 'f',
        },
        quiet: {
          type: 'boolean',
        },
      },
      strict: false,
    })
    _cliArgs = values
  }
  return _cliArgs
}

/**
 * Check if tests should be skipped for a given test file or module.
 * Tests are always run in CI or when --force flag is present.
 */
function shouldRunTests() {
  const args = getCliArgs()

  // Always run in CI.
  if (process.env.CI === 'true') {
    return true
  }

  // Run if force flag is set.
  if (args.force || process.env.FORCE_TEST === '1') {
    return true
  }

  // Run if not in pre-commit hook.
  if (!process.env.PRE_COMMIT) {
    return true
  }

  // In pre-commit, run tests by default (can be customized later).
  return true
}

export { getCliArgs, shouldRunTests }
