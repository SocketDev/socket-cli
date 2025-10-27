/**
 * CMake Build Helper
 *
 * Provides utilities for CMake-based builds with checkpointing and logging.
 */

import { cpus } from 'node:os'

import { exec } from './build-exec.mjs'
import { printStep } from './build-output.mjs'

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
      .map(([key, value]) => `-D${key}=${value}`)
      .join(' ')

    await exec(
      `cmake -S ${this.sourceDir} -B ${this.buildDir} ${cmakeArgs}`,
      { stdio: 'inherit' }
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
    await exec(
      `cmake --build ${this.buildDir} --target ${target} -j ${jobs}`,
      { stdio: 'inherit' }
    )
  }

  /**
   * Clean build directory.
   *
   * @returns {Promise<void>}
   */
  async clean() {
    printStep('Cleaning CMake build')
    await exec(`cmake --build ${this.buildDir} --target clean`)
  }
}
