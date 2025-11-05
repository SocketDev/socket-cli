/**
 * @fileoverview Interactive runner for commands with ctrl+o toggle.
 * Standardized across all socket-* repositories.
 */

import { runWithMask } from '@socketsecurity/lib/stdio/mask'

/**
 * Run a command with interactive output control.
 * Standard experience across all socket-* repos.
 *
 * @param {string} command - Command to run
 * @param {string[]} args - Command arguments
 * @param {object} options - Options
 * @param {string} options.message - Progress message
 * @param {string} options.toggleText - Text after "ctrl+o" (default: "to see output")
 * @param {boolean} options.showOnError - Show output on error (default: true)
 * @param {boolean} options.verbose - Start in verbose mode (default: false)
 * @returns {Promise<number>} Exit code
 */
export async function runWithOutput(command, args = [], options = {}) {
  const {
    cwd = process.cwd(),
    env = process.env,
    message = 'Running',
    toggleText = 'to see output',
    verbose = false,
  } = options

  return runWithMask(command, args, {
    cwd,
    env,
    message,
    showOutput: verbose,
    toggleText,
  })
}

/**
 * Standard test runner with interactive output.
 */
export async function runTests(command, args, options = {}) {
  return runWithOutput(command, args, {
    message: 'Running tests',
    toggleText: 'to see test output',
    ...options,
  })
}

/**
 * Standard lint runner with interactive output.
 */
export async function runLint(command, args, options = {}) {
  return runWithOutput(command, args, {
    message: 'Running linter',
    toggleText: 'to see lint results',
    ...options,
  })
}

/**
 * Standard build runner with interactive output.
 */
export async function runBuild(command, args, options = {}) {
  return runWithOutput(command, args, {
    message: 'Building',
    toggleText: 'to see build output',
    ...options,
  })
}
