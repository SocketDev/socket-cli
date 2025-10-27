/**
 * Command Execution Utilities
 *
 * Provides utilities for executing shell commands with proper error handling,
 * output capture, and logging.
 */

import { spawn } from '@socketsecurity/lib/spawn'

/**
 * Execute command with arguments.
 *
 * @param {string} command - Command to execute
 * @param {string[]|object} argsOrOptions - Arguments array or options object
 * @param {object} [options] - Spawn options (if args provided)
 * @returns {Promise<object>}
 */
export async function exec(command, argsOrOptions = [], options = {}) {
  // Handle both signatures: exec(cmd, opts) and exec(cmd, args, opts).
  const args = Array.isArray(argsOrOptions) ? argsOrOptions : []
  const opts = Array.isArray(argsOrOptions) ? options : argsOrOptions

  const result = await spawn(command, args, {
    stdio: opts.stdio || 'inherit',
    stdioString: true,
    stripAnsi: false,
    ...opts,
  })

  // Treat undefined or null status as success (0).
  const exitCode = result.status ?? 0

  if (exitCode !== 0) {
    const cmdString = args.length ? `${command} ${args.join(' ')}` : command
    const error = new Error(`Command failed with exit code ${exitCode}: ${cmdString}`)
    error.stdout = result.stdout
    error.stderr = result.stderr
    error.code = exitCode
    throw error
  }

  return result
}

/**
 * Execute shell command and capture output.
 * Always uses shell for proper command execution with redirections and pipes.
 *
 * @param {string} command - Shell command to execute
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
