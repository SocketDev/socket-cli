/**
 * Command Execution Utilities
 *
 * Provides utilities for executing shell commands with proper error handling,
 * output capture, and logging.
 */

import { spawn } from '@socketsecurity/lib/spawn'

/**
 * Execute command and inherit stdio.
 *
 * @param {string} command - Command to execute
 * @param {object} options - Spawn options
 * @returns {Promise<void>}
 */
export async function exec(command, options = {}) {
  const result = await spawn(command, [], {
    shell: true,
    stdio: options.stdio || 'pipe',
    stdioString: true,
    stripAnsi: false,
    ...options,
  })

  if (result.status !== 0) {
    const error = new Error(`Command failed with exit code ${result.status}: ${command}`)
    error.stdout = result.stdout
    error.stderr = result.stderr
    error.code = result.status
    throw error
  }

  return result
}

/**
 * Execute command and capture output.
 *
 * @param {string} command - Command to execute
 * @param {object} options - Spawn options
 * @returns {Promise<{stdout: string, stderr: string, code: number}>}
 */
export async function execCapture(command, options = {}) {
  const result = await spawn(command, [], {
    shell: true,
    stdio: 'pipe',
    stdioString: true,
    stripAnsi: false,
    ...options,
  })

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    code: result.status ?? 0,
  }
}
