/**
 * @fileoverview Monorepo script runner utilities for common build operations.
 * Provides DRY helpers for running pnpm scripts, commands, and sequences.
 */

import platformPkg from '@socketsecurity/lib/constants/platform'
import loggerPkg from '@socketsecurity/lib/logger'
import spawnPkg from '@socketsecurity/lib/spawn'

const { WIN32 } = platformPkg
const { getDefaultLogger } = loggerPkg
const { spawn } = spawnPkg

/**
 * Run a pnpm script in a specific package.
 *
 * @param {string} packageName - Package name (e.g., '@socketsecurity/cli')
 * @param {string} scriptName - Script name from package.json
 * @param {string[]} args - Additional arguments
 * @param {object} options - Spawn options
 * @returns {Promise<{code: number, stdout?: string, stderr?: string}>}
 */
export async function runPnpmScript(packageName, scriptName, args = [], options = {}) {
  const pnpmArgs = ['--filter', packageName, 'run', scriptName, ...args]

  return spawn('pnpm', pnpmArgs, {
    shell: WIN32,
    stdio: 'inherit',
    ...options,
  })
}

/**
 * Run a pnpm script across all packages that have the script.
 *
 * @param {string} scriptName - Script name from package.json
 * @param {string[]} args - Additional arguments
 * @param {object} options - Spawn options
 * @returns {Promise<{code: number, stdout?: string, stderr?: string}>}
 */
export async function runPnpmScriptAll(scriptName, args = [], options = {}) {
  const pnpmArgs = ['run', '-r', scriptName, ...args]

  return spawn('pnpm', pnpmArgs, {
    shell: WIN32,
    stdio: 'inherit',
    ...options,
  })
}

/**
 * Run multiple commands in sequence, stopping on first failure.
 *
 * @param {Array<{command: string, args?: string[], options?: object, description?: string}>} commands
 * @param {object} globalOptions - Options to merge into all commands
 * @returns {Promise<number>} Exit code of first failing command, or 0 if all succeed
 */
export async function runSequence(commands, globalOptions = {}) {
  for (const { args = [], command, description, options = {} } of commands) {
    if (description) {
      const logger = getDefaultLogger()
      logger.step(description)
    }

    const result = await spawn(command, args, {
      shell: WIN32,
      stdio: 'inherit',
      ...globalOptions,
      ...options,
    })

    if (result.code !== 0) {
      return result.code
    }
  }

  return 0
}

/**
 * Run multiple commands in parallel.
 *
 * @param {Array<{command: string, args?: string[], options?: object}>} commands
 * @param {object} globalOptions - Options to merge into all commands
 * @returns {Promise<Array<{code: number, stdout?: string, stderr?: string}>>}
 */
export async function runParallel(commands, globalOptions = {}) {
  const promises = commands.map(({ args = [], command, options = {} }) =>
    spawn(command, args, {
      shell: WIN32,
      stdio: 'inherit',
      ...globalOptions,
      ...options,
    }),
  )

  return Promise.all(promises)
}

/**
 * Run a command quietly (capture output).
 *
 * @param {string} command - Command to run
 * @param {string[]} args - Arguments
 * @param {object} options - Spawn options
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
export async function runQuiet(command, args = [], options = {}) {
  return spawn(command, args, {
    shell: WIN32,
    stdio: 'pipe',
    stdioString: true,
    ...options,
  })
}

/**
 * Common pnpm operations with proper error handling.
 */
export const pnpm = {
  /**
   * Run pnpm install with frozen lockfile.
   */
  install: async (options = {}) => {
    logger.step('Installing dependencies')
    return spawn('pnpm', ['install', '--frozen-lockfile'], {
      shell: WIN32,
      stdio: 'inherit',
      ...options,
    })
  },

  /**
   * Build all packages or specific package.
   */
  build: async (packageName = null, options = {}) => {
    logger.step(packageName ? `Building ${packageName}` : 'Building packages')
    const args = packageName
      ? ['--filter', packageName, 'run', 'build']
      : ['run', '-r', 'build']

    return spawn('pnpm', args, {
      shell: WIN32,
      stdio: 'inherit',
      ...options,
    })
  },

  /**
   * Run tests in specific package or all packages.
   */
  test: async (packageName = null, options = {}) => {
    logger.step(packageName ? `Testing ${packageName}` : 'Running tests')
    const args = packageName
      ? ['--filter', packageName, 'run', 'test']
      : ['run', '-r', 'test']

    return spawn('pnpm', args, {
      shell: WIN32,
      stdio: 'inherit',
      ...options,
    })
  },
}
