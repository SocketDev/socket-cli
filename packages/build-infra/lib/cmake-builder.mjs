/**
 * CMake Build Helper
 *
 * Provides utilities for CMake-based builds with checkpointing and logging.
 */

import { cpus } from 'node:os'

import platformPkg from '@socketsecurity/lib-external/constants/platform'
import spawnPkg from '@socketsecurity/lib-external/spawn'

const { WIN32 } = platformPkg
const { spawn } = spawnPkg

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
      .map(([key, value]) => [`-D${key}=${value}`])
      .flat()

    const result = await spawn(
      'cmake',
      ['-S', this.sourceDir, '-B', this.buildDir, ...cmakeArgs],
      { shell: WIN32, stdio: 'inherit' }
    )
    if (result.code !== 0) {
      throw new Error(`cmake configure failed with exit code ${result.code}`)
    }
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
    const result = await spawn(
      'cmake',
      ['--build', this.buildDir, '--target', target, '-j', String(jobs)],
      { shell: WIN32, stdio: 'inherit' }
    )
    if (result.code !== 0) {
      throw new Error(`cmake build failed with exit code ${result.code}`)
    }
  }

  /**
   * Clean build directory.
   *
   * @returns {Promise<void>}
   */
  async clean() {
    printStep('Cleaning CMake build')
    const result = await spawn(
      'cmake',
      ['--build', this.buildDir, '--target', 'clean'],
      { shell: WIN32, stdio: 'inherit' }
    )
    if (result.code !== 0) {
      throw new Error(`cmake clean failed with exit code ${result.code}`)
    }
  }
}
