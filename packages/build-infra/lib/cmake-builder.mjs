/**
 * CMake Build Helper
 *
 * Provides utilities for CMake-based builds with checkpointing and logging.
 */

import { cpus } from 'node:os'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { spawn } from '@socketsecurity/lib/spawn'

import { printStep } from './build-output.mjs'

/**
 * Execute command using spawn with shell.
 */
async function exec(command, options = {}) {
  const result = await spawn(command, [], {
    stdio: 'inherit',
    shell: WIN32,
    ...options,
  })
  if (result.code !== 0) {
    throw new Error(`Command failed with exit code ${result.code}: ${command}`)
  }
}

export class CMakeBuilder {
  constructor(sourceDir, buildDir) {
    this.sourceDir = sourceDir
    this.buildDir = buildDir
  }

  /**
   * Configure CMake project.
   *
   * @param {object} options - CMake options as key-value pairs
   * @returns {Promise<void>}
   */
  async configure(options = {}) {
    printStep('Configuring CMake')

    const cmakeArgs = Object.entries(options)
      .map(([key, value]) => [`-D${key}=${value}`])
      .flat()

    await spawn(
      'cmake',
      ['-S', this.sourceDir, '-B', this.buildDir, ...cmakeArgs],
      { shell: WIN32, stdio: 'inherit' }
    )
  }

  /**
   * Build CMake project.
   *
   * @param {object} options - Build options
   * @param {boolean} options.parallel - Use parallel jobs (default: true)
   * @param {string} options.target - Build target (default: 'all')
   * @returns {Promise<void>}
   */
  async build({ parallel = true, target = 'all' } = {}) {
    printStep('Building with CMake')

    const jobs = parallel ? cpus().length : 1
    await spawn(
      'cmake',
      ['--build', this.buildDir, '--target', target, '-j', String(jobs)],
      { shell: WIN32, stdio: 'inherit' }
    )
  }

  /**
   * Clean build directory.
   *
   * @returns {Promise<void>}
   */
  async clean() {
    printStep('Cleaning CMake build')
    await spawn(
      'cmake',
      ['--build', this.buildDir, '--target', 'clean'],
      { shell: WIN32, stdio: 'inherit' }
    )
  }
}
