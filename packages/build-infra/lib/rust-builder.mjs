/**
 * Rust WASM Builder
 *
 * Provides utilities for building Rust projects to WebAssembly using Cargo + wasm-bindgen.
 */

import { cpus } from 'node:os'
import path from 'node:path'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { spawn } from '@socketsecurity/lib/spawn'
// Removed exec from './build-exec.mjs'
import { printStep } from './build-output.mjs'

/**
 * Modern WASM feature flags for RUSTFLAGS.
 * Enables SIMD, bulk-memory, and other modern WASM instructions.
 *
 * COMPATIBILITY: Requires modern runtimes (Chrome 91+, Firefox 89+, Node 16+).
 */
export const MODERN_WASM_RUSTFLAGS = [
  '-C target-feature=+simd128',
  '-C target-feature=+bulk-memory',
  '-C target-feature=+mutable-globals',
  '-C target-feature=+sign-ext',
  '-C target-feature=+nontrapping-fptoint',
  '-C target-feature=+reference-types',
  '-C overflow-checks=off',
  '-C debug-assertions=off',
].join(' ')

/**
 * Aggressive wasm-opt optimization flags for size.
 */
export const WASM_OPT_SIZE_FLAGS = [
  '-Oz', // Optimize aggressively for size
  '--enable-simd',
  '--enable-bulk-memory',
  '--enable-sign-ext',
  '--enable-mutable-globals',
  '--enable-nontrapping-float-to-int',
  '--enable-reference-types',
  '--low-memory-unused',
  '--flatten',
  '--rereloop',
  '--vacuum',
  '--dce',
  '--remove-unused-names',
  '--remove-unused-module-elements',
  '--strip-debug',
  '--strip-dwarf',
  '--strip-producers',
  '--strip-target-features',
].join(' ')

export class RustBuilder {
  constructor(projectDir, buildDir) {
    this.projectDir = projectDir
    this.buildDir = buildDir
  }

  /**
   * Install wasm32-unknown-unknown target.
   *
   * @returns {Promise<void>}
   */
  async installWasmTarget() {
    printStep('Installing wasm32-unknown-unknown target')
    await exec('rustup target add wasm32-unknown-unknown', { stdio: 'inherit' })
  }

  /**
   * Build Rust project to WASM with Cargo.
   *
   * @param {object} options - Build options
   * @param {string} options.profile - Cargo profile (default: 'release')
   * @param {string[]} options.features - Cargo features to enable
   * @param {string[]} options.rustflags - RUSTFLAGS to set (default: MODERN_WASM_RUSTFLAGS)
   * @param {boolean} options.parallel - Use parallel compilation (default: true)
   * @returns {Promise<void>}
   */
  async build({
    features = [],
    parallel = true,
    profile = 'release',
    rustflags = MODERN_WASM_RUSTFLAGS,
  } = {}) {
    printStep('Building Rust to WASM with Cargo')

    const featuresFlag = features.length > 0 ? `--features ${features.join(',')}` : ''
    const profileFlag = profile !== 'release' ? `--profile ${profile}` : '--release'
    const jobs = parallel ? cpus().length : 1

    const env = {
      ...process.env,
      RUSTFLAGS: rustflags,
    }

    await exec(
      `cargo build --target wasm32-unknown-unknown ${profileFlag} ${featuresFlag} -j ${jobs}`,
      { cwd: this.projectDir, env, stdio: 'inherit' }
    )
  }

  /**
   * Run wasm-bindgen to generate JavaScript bindings.
   *
   * @param {object} options - wasm-bindgen options
   * @param {string} options.input - Input WASM file path (relative to project dir)
   * @param {string} options.outDir - Output directory for generated files (default: 'build/pkg')
   * @param {string} options.target - Target environment: 'nodejs', 'web', 'bundler', 'no-modules' (default: 'nodejs')
   * @param {boolean} options.typescript - Generate TypeScript definitions (default: true)
   * @param {boolean} options.debug - Enable debug mode (default: false)
   * @returns {Promise<void>}
   */
  async generateBindings({
    debug = false,
    input,
    outDir = 'build/pkg',
    target = 'nodejs',
    typescript = true,
  }) {
    printStep('Generating JavaScript bindings with wasm-bindgen')

    const debugFlag = debug ? '--debug' : ''
    const tsFlag = typescript ? '--typescript' : '--no-typescript'
    const outputPath = path.join(this.projectDir, outDir)

    await exec(
      `wasm-bindgen --target ${target} ${tsFlag} ${debugFlag} --out-dir ${outputPath} ${input}`,
      { cwd: this.projectDir, stdio: 'inherit' }
    )
  }

  /**
   * Optimize WASM with wasm-opt (Binaryen).
   *
   * @param {string} wasmFile - Path to WASM file (relative to project dir)
   * @param {object} options - Optimization options
   * @param {string} options.flags - Custom wasm-opt flags (default: WASM_OPT_SIZE_FLAGS)
   * @param {string} options.output - Output file path (default: same as input)
   * @returns {Promise<void>}
   */
  async optimize(wasmFile, { flags = WASM_OPT_SIZE_FLAGS, output } = {}) {
    printStep('Optimizing WASM with wasm-opt')

    const inputPath = path.join(this.projectDir, wasmFile)
    const outputPath = output ? path.join(this.projectDir, output) : inputPath

    await exec(`wasm-opt ${flags} "${inputPath}" -o "${outputPath}"`, {
      stdio: 'inherit',
    })
  }

  /**
   * Check if Rust toolchain is installed.
   *
   * @returns {Promise<boolean>}
   */
  async checkRustInstalled() {
    try {
      await exec('rustc --version', { stdio: 'pipe' })
      return true
    } catch {
      return false
    }
  }

  /**
   * Check if wasm-bindgen CLI is installed.
   *
   * @returns {Promise<boolean>}
   */
  async checkWasmBindgenInstalled() {
    try {
      await exec('wasm-bindgen --version', { stdio: 'pipe' })
      return true
    } catch {
      return false
    }
  }

  /**
   * Check if wasm-opt (Binaryen) is installed.
   *
   * @returns {Promise<boolean>}
   */
  async checkWasmOptInstalled() {
    try {
      await exec('wasm-opt --version', { stdio: 'pipe' })
      return true
    } catch {
      return false
    }
  }

  /**
   * Full build pipeline: Cargo build → wasm-bindgen → wasm-opt.
   *
   * @param {object} options - Build pipeline options
   * @param {string} options.profile - Cargo profile (default: 'release')
   * @param {string[]} options.features - Cargo features to enable
   * @param {string} options.packageName - Package name (for finding .wasm file)
   * @param {string} options.outDir - Output directory (default: 'build/pkg')
   * @param {string} options.target - wasm-bindgen target (default: 'nodejs')
   * @param {boolean} options.optimize - Run wasm-opt (default: true)
   * @returns {Promise<void>}
   */
  async buildPipeline({
    features = [],
    optimize = true,
    outDir = 'build/pkg',
    packageName,
    profile = 'release',
    target = 'nodejs',
  }) {
    if (!packageName) {
      throw new Error('packageName is required for buildPipeline')
    }

    // Step 1: Install target.
    await this.installWasmTarget()

    // Step 2: Build with Cargo.
    await this.build({ features, parallel: true, profile })

    // Step 3: Locate built WASM file.
    const profileDir = profile === 'release' ? 'release' : profile
    const wasmInput = `target/wasm32-unknown-unknown/${profileDir}/${packageName}.wasm`

    // Step 4: Generate bindings.
    await this.generateBindings({
      debug: false,
      input: wasmInput,
      outDir,
      target,
      typescript: true,
    })

    // Step 5: Optimize with wasm-opt.
    if (optimize) {
      const wasmOutput = path.join(outDir, `${packageName}_bg.wasm`)
      await this.optimize(wasmOutput)
    }
  }
}
