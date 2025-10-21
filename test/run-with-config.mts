/**
 * Test utility for running Socket CLI commands with configuration.
 * Automatically adds --config {} to prevent using user's local configuration.
 *
 * Key Functions:
 * - runWithConfig: Execute Socket CLI with isolated configuration
 *
 * Features:
 * - Automatically appends --config {} if not present
 * - Returns structured result with exitCode, stdout, and stderr
 * - Prevents test pollution from user's local Socket configuration
 *
 * Usage:
 * - Use for testing CLI commands in isolation
 * - Ensures reproducible test results across environments
 * - Prevents authentication token leakage in tests
 *
 * @example
 * const result = await runWithConfig('scan', 'create', '--json')
 * expect(result.exitCode).toBe(0)
 * const json = JSON.parse(result.stdout)
 */

import constants from '../src/constants.mts'
import { spawnSocketCli } from './utils.mts'

/**
 * Run Socket CLI command with isolated configuration.
 * @param args Command arguments to pass to Socket CLI.
 * @returns Object containing exitCode, stdout, and stderr.
 */
export async function runWithConfig(...args: string[]) {
  const { binCliPath } = constants
  // Add --config {} if not present.
  if (!args.includes('--config')) {
    args.push('--config', '{}')
  }
  const result = await spawnSocketCli(binCliPath, args)
  return {
    exitCode: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}
