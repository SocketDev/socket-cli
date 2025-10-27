/**
 * Emscripten Build Helper
 *
 * Provides utilities for building C++ projects to WebAssembly using Emscripten.
 */

import { cpus } from 'node:os'
import path from 'node:path'

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

/**
 * Aggressive WASM optimization flags.
 */
export const WASM_OPT_FLAGS = [
  '--asyncify',
  '--cfunc-name-cache',
  '--closure=1',
  '--enable-bulk-memory',
  '--enable-sign-ext',
  '--low-memory-unused',
  '--merge-data-segments',
  '--merge-data-segments-lowering',
  '--optimize-added-constants',
  '--optimize-added-constants-propagate',
  '--optimize-casts',
  '--optimize-instructions',
  '--precompute',
  '--precompute-propagate',
  '--rereloop',
  '--rse',
  '--simplify-locals',
  '--vacuum',
].join(' ')

export class EmscriptenBuilder {
  constructor(sourceDir, buildDir) {
    this.sourceDir = sourceDir
    this.buildDir = buildDir
  }

  /**
   * Build with Emscripten.
   *
   * @param {object} options - Build options
   * @param {string[]} options.sources - Source file patterns
   * @param {string} options.output - Output filename
   * @param {string[]} options.flags - Compiler flags
   * @param {string[]} options.includes - Include directories
   * @param {string[]} options.defines - Preprocessor defines
   * @param {boolean} options.optimize - Apply aggressive optimizations (default: true)
   * @returns {Promise<void>}
   */
  async build({
    defines = [],
    flags = [],
    includes = [],
    optimize = true,
    output,
    sources,
  }) {
    printStep('Building with Emscripten')

    const sourceFiles = sources.join(' ')
    const includeFlags = includes.join(' ')
    const defineFlags = defines.map((d) => `-D${d}`).join(' ')
    const compilerFlags = flags.join(' ')
    const outputPath = path.join(this.buildDir, output)

    let emccCommand = `emcc ${sourceFiles} ${includeFlags} ${defineFlags} ${compilerFlags} -o ${outputPath}`

    if (optimize) {
      emccCommand += ` ${WASM_OPT_FLAGS}`
    }

    await exec(emccCommand, { cwd: this.sourceDir, stdio: 'inherit' })
  }

  /**
   * Run wasm-opt on built WASM file.
   *
   * @param {string} wasmFile - WASM filename in build directory
   * @param {object} options - Optimization options
   * @param {number} options.optimizeLevel - Optimization level (1-4, default: 4)
   * @param {number} options.shrinkLevel - Shrink level (1-2, default: 2)
   * @returns {Promise<void>}
   */
  async optimize(wasmFile, { optimizeLevel = 4, shrinkLevel = 2 } = {}) {
    printStep('Running wasm-opt')

    const wasmPath = path.join(this.buildDir, wasmFile)

    await exec(
      `wasm-opt -O${optimizeLevel} -s ${shrinkLevel} ${wasmPath} -o ${wasmPath}`,
      { stdio: 'inherit' }
    )
  }

  /**
   * Strip debug info from WASM file.
   *
   * @param {string} wasmFile - WASM filename in build directory
   * @returns {Promise<void>}
   */
  async strip(wasmFile) {
    printStep('Stripping debug info')

    const wasmPath = path.join(this.buildDir, wasmFile)

    await exec(`wasm-strip ${wasmPath}`, { stdio: 'inherit' })
  }

  /**
   * Configure CMake for Emscripten build.
   *
   * @param {object} options - CMake options as key-value pairs
   * @returns {Promise<void>}
   */
  async configureCMake(options = {}) {
    printStep('Configuring CMake for Emscripten')

    // Determine toolchain file path based on installation type.
    // Homebrew: /opt/homebrew/Cellar/emscripten/VERSION/libexec/cmake/Modules/Platform/Emscripten.cmake
    // Standard EMSDK: $EMSDK/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake
    let toolchainFile
    if (process.env.EMSCRIPTEN) {
      // Homebrew installation.
      toolchainFile = `${process.env.EMSCRIPTEN}/cmake/Modules/Platform/Emscripten.cmake`
    } else {
      // Standard EMSDK installation.
      toolchainFile = `${process.env.EMSDK}/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake`
    }

    const cmakeArgs = Object.entries({
      CMAKE_TOOLCHAIN_FILE: toolchainFile,
      ...options,
    })
      .map(([key, value]) => `-D${key}=${value}`)
      .join(' ')

    await exec(
      `emcmake cmake -S ${this.sourceDir} -B ${this.buildDir} ${cmakeArgs}`,
      { stdio: 'inherit' }
    )
  }

  /**
   * Build with emmake (CMake + Emscripten).
   *
   * @param {object} options - Build options
   * @param {boolean} options.parallel - Use parallel jobs (default: true)
   * @param {string} options.target - Build target (default: 'all')
   * @returns {Promise<void>}
   */
  async buildWithCMake({ parallel = true, target = 'all' } = {}) {
    printStep('Building with emmake')

    const jobs = parallel ? cpus().length : 1
    await exec(
      `emmake cmake --build ${this.buildDir} --target ${target} -j ${jobs}`,
      { stdio: 'inherit' }
    )
  }
}
