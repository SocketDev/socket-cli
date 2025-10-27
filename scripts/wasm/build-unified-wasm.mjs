/**
 * Build unified WASM bundle with all models embedded.
 *
 * USAGE:
 * - Production build: node scripts/wasm/build-unified-wasm.mjs
 * - Dev build (3-5x faster): node scripts/wasm/build-unified-wasm.mjs --dev
 *
 * PROCESS:
 * 1. Check Rust toolchain (install if missing)
 * 2. Download/verify all model files
 * 2.5. Check and install binaryen (wasm-opt) if missing
 * 3. Build Rust WASM bundle with wasm-pack
 *    - Production: --release (thin LTO, opt-level="z", strip symbols)
 *    - Dev: --profile dev-wasm (opt-level=1, no LTO, 16 codegen-units)
 * 4. Optimize with wasm-opt -Oz (5-15% size reduction)
 * 5. Compress with brotli at maximum quality (11)
 * 6. Embed WASM as base64 in JavaScript file
 *
 * OPTIMIZATIONS (aggressive, no backward compat):
 * - Cargo profiles: dev-wasm for fast iteration, release for production
 * - Thin LTO: 5-10% faster builds than full LTO, similar size reduction
 * - Strip symbols: 5-10% additional size reduction
 * - Disabled overflow checks and debug assertions (smaller, faster)
 * - WASM features: SIMD, bulk-memory, sign-ext, mutable-globals, reference-types
 * - wasm-opt aggressive: Multiple optimization passes, modern features
 * - Brotli compression: ~70% size reduction with quality 11
 *
 * INT4 QUANTIZATION:
 * - CodeT5 models use INT4 (4-bit weights) for 50% size reduction
 * - Only 1-2% quality loss compared to INT8
 *
 * OUTPUT:
 * - build/wasm-bundle/pkg/socket_ai_bg.wasm (~115MB with INT4)
 * - packages/cli/build/unified-wasm.mjs (brotli-compressed, base64-encoded WASM)
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync } from 'node:zlib'

import { logger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { checkRustToolchain, getRustPaths } from './check-rust-toolchain.mjs'
import { downloadModels } from './download-models.mjs'

/**
 * Execute command and wait for completion.
 */
async function exec(command, args, options = {}) {
  const result = await spawn(command, args, {
    stdio: options.stdio || 'pipe',
    stdioString: true,
    stripAnsi: false,
    ...options,
  })

  return {
    code: result.status ?? 0,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  }
}

/**
 * Check if binaryen (wasm-opt) is installed.
 */
async function checkBinaryenInstalled() {
  try {
    await exec('wasm-opt', ['--version'])
    return true
  } catch {
    return false
  }
}

/**
 * Install binaryen (wasm-opt) cross-platform.
 */
async function installBinaryen() {
  const isWindows = process.platform === 'win32'
  const isMacOS = process.platform === 'darwin'
  const isLinux = process.platform === 'linux'

  logger.progress(
    'Installing binaryen (wasm-opt) - this may take a few minutes',
  )

  try {
    if (isMacOS) {
      // macOS: Try Homebrew first.
      logger.substep('Trying Homebrew installation')
      try {
        await exec('brew', ['--version'])
        await exec('brew', ['install', 'binaryen'], { stdio: 'inherit' })
        logger.done('binaryen installed via Homebrew')
        return true
      } catch {
        logger.warn('Homebrew not available, trying GitHub releases')
      }
    } else if (isLinux) {
      // Linux: Try apt-get first (Ubuntu/Debian).
      logger.substep('Trying apt-get installation')
      try {
        await exec('sudo', ['apt-get', 'update'], { stdio: 'pipe' })
        await exec('sudo', ['apt-get', 'install', '-y', 'binaryen'], {
          stdio: 'inherit',
        })
        logger.done('binaryen installed via apt-get')
        return true
      } catch {
        logger.warn('apt-get not available or failed, trying GitHub releases')
      }
    } else if (isWindows) {
      // Windows: Try chocolatey first.
      logger.substep('Trying Chocolatey installation')
      try {
        await exec('choco', ['--version'])
        await exec('choco', ['install', 'binaryen', '-y'], { stdio: 'inherit' })
        logger.done('binaryen installed via Chocolatey')
        return true
      } catch {
        logger.warn('Chocolatey not available, trying GitHub releases')
      }
    }

    // Fallback: Download from GitHub releases (all platforms).
    logger.substep('Downloading pre-built binaryen from GitHub')
    const version = 'version_119' // Latest stable as of implementation.
    let platformSuffix = ''

    if (isWindows) {
      platformSuffix = 'x86_64-windows'
    } else if (isMacOS) {
      platformSuffix = process.arch === 'arm64' ? 'arm64-macos' : 'x86_64-macos'
    } else if (isLinux) {
      platformSuffix = 'x86_64-linux'
    }

    const url = `https://github.com/WebAssembly/binaryen/releases/download/${version}/binaryen-${version}-${platformSuffix}.tar.gz`
    logger.substep(`URL: ${url}`)

    // For CI/automation, we'll gracefully degrade if GitHub releases download fails.
    logger.warn('GitHub releases download not yet implemented')
    logger.warn(
      'wasm-opt will be skipped (install manually for smaller bundles)',
    )
    return false
  } catch (e) {
    logger.error(`Failed to install binaryen: ${e.message}`)
    logger.warn(
      'wasm-opt will be skipped (install manually for optimal bundle size)',
    )
    return false
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '../..')
const wasmBundleDir = path.join(rootPath, 'build/wasm-bundle')
const cliBuildDir = path.join(rootPath, 'packages/cli/build')

logger.step('Build Unified WASM Bundle')

// Step 1: Check Rust toolchain.
logger.substep('Step 1: Checking Rust toolchain')
const hasRust = await checkRustToolchain()
if (!hasRust) {
  logger.error('Rust toolchain setup failed')
  logger.error('Please install manually: https://rustup.rs/')
  process.exit(1)
}

// Step 2: Download models.
logger.substep('Step 2: Downloading model files')
const hasModels = await downloadModels()
if (!hasModels) {
  logger.error('Model download incomplete')
  logger.error('Please run: node scripts/wasm/convert-codet5.mjs')
  process.exit(1)
}

// Step 2.5: Optimize embedded WASM files (the big wins).
logger.substep('Step 2.5: Optimizing embedded WASM files')
logger.info('This optimizes the third-party WASM (ONNX, Yoga) BEFORE embedding')
const optimizeScript = path.join(__dirname, 'optimize-embedded-wasm.mjs')
try {
  const optimizeArgs = [optimizeScript]
  if (!isDev) {
    optimizeArgs.push('--aggressive')
  }
  const optimizeResult = await exec('node', optimizeArgs, { stdio: 'inherit' })
  if (optimizeResult.code !== 0) {
    logger.warn('WASM optimization failed, using original files')
  }
} catch (e) {
  logger.warn(`WASM optimization skipped: ${e.message}`)
  logger.warn('Will use original unoptimized WASM files')
}

// Step 2.5: Check and install binaryen for wasm-opt.
logger.substep('Step 2.5: Checking binaryen (wasm-opt)')
const hasBinaryen = await checkBinaryenInstalled()
if (!hasBinaryen) {
  logger.warn('binaryen (wasm-opt) not found')

  const binaryenInstalled = await installBinaryen()
  if (!binaryenInstalled) {
    logger.warn('wasm-opt not available - bundle will be slightly larger')
  }
} else {
  logger.info('binaryen (wasm-opt) found')
}

// Step 3: Build WASM with wasm-pack.
logger.substep('Step 3: Building WASM bundle')

const { wasmPack } = getRustPaths()
const pkgDir = path.join(wasmBundleDir, 'pkg')

logger.progress('Running wasm-pack build')
logger.substep(`Source: ${wasmBundleDir}`)
logger.substep(`Output: ${pkgDir}`)

// Force wasm-pack to use rustup's toolchain by modifying PATH.
const { homedir } = await import('node:os')
const cargoHome = process.env.CARGO_HOME || path.join(homedir(), '.cargo')
const cargoBin = path.join(cargoHome, 'bin')

// Support dev mode for faster builds (3-5x faster).
const isDev = process.argv.includes('--dev')
const profileArgs = isDev ? ['--profile', 'dev-wasm'] : ['--release']

if (isDev) {
  logger.substep('Using dev-wasm profile (fast, minimal optimization)')
}

// Set up build environment with optimizations.
const buildEnv = {
  ...process.env,
  // Put cargo/bin first in PATH to prioritize rustup's toolchain.
  PATH: `${cargoBin}${path.delimiter}${process.env.PATH}`,
}

// Add RUSTFLAGS for additional optimizations (if not already set).
if (!buildEnv.RUSTFLAGS) {
  const rustFlags = [
    '-C target-feature=+simd128', // Enable WASM SIMD (73% browser support)
    '-C target-feature=+bulk-memory', // Bulk memory operations (faster copies)
    '-C target-feature=+mutable-globals', // Mutable globals support
    '-C target-feature=+sign-ext', // Sign extension operations
  ]

  // Production-only optimizations.
  if (!isDev) {
    rustFlags.push(
      '-C link-arg=--strip-debug', // Strip debug info
      '-C link-arg=--strip-all', // Strip all symbols
      '-C link-arg=-zstack-size=131072', // Smaller stack size (128KB)
      '-C embed-bitcode=yes', // Embed bitcode for LTO
    )
  }

  buildEnv.RUSTFLAGS = rustFlags.join(' ')
  logger.substep(`RUSTFLAGS: ${buildEnv.RUSTFLAGS}`)
}

const buildResult = await exec(
  wasmPack,
  [
    'build',
    wasmBundleDir,
    '--target',
    'web',
    '--out-dir',
    pkgDir,
    '--out-name',
    'socket_ai',
    ...profileArgs,
  ],
  {
    stdio: 'inherit',
    env: buildEnv,
  },
)

if (buildResult.code !== 0) {
  logger.error('wasm-pack build failed')
  process.exit(1)
}

logger.done('wasm-pack build complete')

// Step 4: Check size and optionally optimize.
const wasmFile = path.join(pkgDir, 'socket_ai_bg.wasm')
if (!existsSync(wasmFile)) {
  logger.error(`WASM file not found: ${wasmFile}`)
  process.exit(1)
}

let stats = await fs.stat(wasmFile)
const originalSize = stats.size
logger.info(`WASM bundle size: ${(originalSize / 1024 / 1024).toFixed(2)} MB`)

// Try to optimize with wasm-opt if available (5-15% size reduction).
let optimizationSucceeded = false
try {
  logger.progress('Optimizing with wasm-opt (aggressive)')

  // Aggressive optimization flags (no backward compat needed).
  const wasmOptFlags = [
    '-Oz', // Optimize for size
    '--enable-simd', // Enable SIMD operations
    '--enable-bulk-memory', // Enable bulk memory
    '--enable-sign-ext', // Enable sign extension
    '--enable-mutable-globals', // Enable mutable globals
    '--enable-nontrapping-float-to-int', // Non-trapping float conversions
    '--enable-reference-types', // Enable reference types
    '--low-memory-unused', // Optimize for low memory usage
    '--flatten', // Flatten IR for better optimization
    '--rereloop', // Optimize control flow
    '--vacuum', // Remove unused code
  ]

  const optResult = await exec('wasm-opt', [...wasmOptFlags, wasmFile, '-o', wasmFile], {
    stdio: 'inherit',
  })

  if (optResult.code === 0) {
    stats = await fs.stat(wasmFile)
    const optimizedSize = stats.size
    const savings = ((1 - optimizedSize / originalSize) * 100).toFixed(1)
    logger.done(
      `Optimized: ${(optimizedSize / 1024 / 1024).toFixed(2)} MB (${savings}% reduction)`,
    )
    optimizationSucceeded = true
  } else {
    logger.warn('wasm-opt optimization failed (continuing with unoptimized)')
    logger.substep('Install binaryen for optimization: brew install binaryen')
  }
} catch (_e) {
  logger.warn('wasm-opt not available (install binaryen for optimization)')
  logger.substep('macOS: brew install binaryen')
  logger.substep('Linux: sudo apt-get install binaryen')
  logger.substep('Windows: choco install binaryen')
}

// Report final size.
if (!optimizationSucceeded) {
  logger.info(`Final size: ${(originalSize / 1024 / 1024).toFixed(2)} MB (unoptimized)`)
}

// Step 5: Embed as base64 in JavaScript.
logger.substep('Step 5: Embedding WASM as base64')

logger.progress('Reading WASM binary')
const wasmData = await fs.readFile(wasmFile)
logger.done(`Read ${wasmData.length} bytes`)

logger.progress('Compressing with brotli (quality 11 - maximum)')
const { constants } = await import('node:zlib')
const wasmCompressed = brotliCompressSync(wasmData, {
  params: {
    [constants.BROTLI_PARAM_QUALITY]: 11, // Maximum quality (0-11)
    [constants.BROTLI_PARAM_SIZE_HINT]: wasmData.length, // Hint for better compression
    [constants.BROTLI_PARAM_LGWIN]: 24, // Maximum window size (10-24)
    [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_GENERIC, // Generic mode for binary data
  },
})
const compressionRatio = (
  (wasmCompressed.length / wasmData.length) *
  100
).toFixed(1)
logger.done(
  `Compressed: ${wasmCompressed.length} bytes (${compressionRatio}% of original)`,
)

logger.progress('Encoding as base64')
const wasmBase64 = wasmCompressed.toString('base64')
logger.done(`Encoded: ${wasmBase64.length} bytes`)

// Generate unified-wasm.mjs.
logger.progress('Generating packages/cli/build/unified-wasm.mjs')

const syncContent = `/**
 * Unified WASM Loader for Socket CLI AI Features
 *
 * This file is AUTO-GENERATED by scripts/wasm/build-unified-wasm.mjs
 * DO NOT EDIT MANUALLY - changes will be overwritten on next build.
 *
 * Contains:
 * - ONNX Runtime (~2-5MB)
 * - MiniLM model (~17MB int8)
 * - CodeT5 encoder (~30MB int4)
 * - CodeT5 decoder (~60MB int4)
 * - Tokenizers (~1MB)
 * - Yoga Layout (~95KB)
 *
 * INT4 Quantization:
 * - CodeT5 models use INT4 (4-bit weights) for 50% size reduction
 * - Only 1-2% quality loss compared to INT8
 *
 * Original size: ${(wasmData.length / 1024 / 1024).toFixed(2)} MB
 * Compressed: ${(wasmCompressed.length / 1024 / 1024).toFixed(2)} MB (${compressionRatio}%)
 * Base64: ${(wasmBase64.length / 1024 / 1024).toFixed(2)} MB
 */

import { brotliDecompressSync } from 'node:zlib'

// Embedded WASM (brotli-compressed, base64-encoded).
const WASM_BASE64 = '${wasmBase64}'

let wasmModule = null
let wasmInstance = null

/**
 * Load WASM module synchronously.
 *
 * @returns WebAssembly.Instance
 */
export function loadWasmSync() {
  if (wasmInstance) {
    return wasmInstance
  }

  // Decode base64 to Buffer.
  const compressed = Buffer.from(WASM_BASE64, 'base64')

  // Decompress with brotli.
  const decompressed = brotliDecompressSync(compressed)

  // Create WebAssembly module.
  wasmModule = new WebAssembly.Module(decompressed)
  wasmInstance = new WebAssembly.Instance(wasmModule, {})

  return wasmInstance
}

/**
 * Get WASM exports (lazy-loaded).
 */
export function getWasmExports() {
  if (!wasmInstance) {
    loadWasmSync()
  }
  return wasmInstance.exports
}

/**
 * Load MiniLM model from WASM linear memory.
 */
export function loadMinilmModelSync() {
  const exports = getWasmExports()
  const ptr = exports.get_minilm_model_ptr()
  const size = exports.get_minilm_model_size()
  const memory = new Uint8Array(exports.memory.buffer, ptr, size)
  return new Uint8Array(memory)
}

/**
 * Load CodeT5 encoder from WASM linear memory.
 */
export function loadCodet5EncoderSync() {
  const exports = getWasmExports()
  const ptr = exports.get_codet5_encoder_ptr()
  const size = exports.get_codet5_encoder_size()
  const memory = new Uint8Array(exports.memory.buffer, ptr, size)
  return new Uint8Array(memory)
}

/**
 * Load CodeT5 decoder from WASM linear memory.
 */
export function loadCodet5DecoderSync() {
  const exports = getWasmExports()
  const ptr = exports.get_codet5_decoder_ptr()
  const size = exports.get_codet5_decoder_size()
  const memory = new Uint8Array(exports.memory.buffer, ptr, size)
  return new Uint8Array(memory)
}

/**
 * Load MiniLM tokenizer from WASM linear memory.
 */
export function loadMinilmTokenizerSync() {
  const exports = getWasmExports()
  const ptr = exports.get_minilm_tokenizer_ptr()
  const size = exports.get_minilm_tokenizer_size()
  const memory = new Uint8Array(exports.memory.buffer, ptr, size)
  const text = new TextDecoder().decode(memory)
  return JSON.parse(text)
}

/**
 * Load CodeT5 tokenizer from WASM linear memory.
 */
export function loadCodet5TokenizerSync() {
  const exports = getWasmExports()
  const ptr = exports.get_codet5_tokenizer_ptr()
  const size = exports.get_codet5_tokenizer_size()
  const memory = new Uint8Array(exports.memory.buffer, ptr, size)
  const text = new TextDecoder().decode(memory)
  return JSON.parse(text)
}

/**
 * Load ONNX Runtime WASM from embedded data.
 */
export function loadOnnxRuntimeSync() {
  const exports = getWasmExports()
  const ptr = exports.get_onnx_runtime_ptr()
  const size = exports.get_onnx_runtime_size()
  const memory = new Uint8Array(exports.memory.buffer, ptr, size)
  return new Uint8Array(memory)
}

/**
 * Load Yoga Layout WASM from embedded data.
 */
export function loadYogaLayoutSync() {
  const exports = getWasmExports()
  const ptr = exports.get_yoga_layout_ptr()
  const size = exports.get_yoga_layout_size()
  const memory = new Uint8Array(exports.memory.buffer, ptr, size)
  return new Uint8Array(memory)
}

/**
 * Get embedded asset sizes.
 */
export function getEmbeddedSizes() {
  return {
    compressed: ${wasmCompressed.length},
    original: ${wasmData.length},
    total: {
      base64: WASM_BASE64.length,
      compressed: ${wasmCompressed.length},
      original: ${wasmData.length},
    },
  }
}
`

// Ensure build directory exists.
await fs.mkdir(cliBuildDir, { recursive: true })

const outputPath = path.join(cliBuildDir, 'unified-wasm.mjs')
await fs.writeFile(outputPath, syncContent, 'utf-8')

logger.done(`Generated ${outputPath}`)
logger.done(`File size: ${(syncContent.length / 1024 / 1024).toFixed(2)} MB`)

logger.success('Build Complete')

logger.info('Summary:')
logger.info(`  Original WASM: ${(wasmData.length / 1024 / 1024).toFixed(2)} MB`)
logger.info(
  `  Compressed: ${(wasmCompressed.length / 1024 / 1024).toFixed(2)} MB`,
)
logger.info(`  Base64: ${(wasmBase64.length / 1024 / 1024).toFixed(2)} MB`)
logger.info(
  `  Total savings: ${((1 - wasmCompressed.length / wasmData.length) * 100).toFixed(1)}%`,
)
logger.info('Next steps:')
logger.info('  1. This file will be bundled into dist/cli.js by Rollup')
logger.info('  2. Rollup output will be compressed to dist/cli.js.bz')
logger.info('  3. Native stub or index.js will decompress and execute')
