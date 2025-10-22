/**
 * Build unified WASM bundle with all models embedded.
 *
 * PROCESS:
 * 1. Check Rust toolchain (install if missing)
 * 2. Download/verify all model files
 * 2.5. Check and install binaryen (wasm-opt) if missing
 * 3. Build Rust WASM bundle with wasm-pack
 * 4. Optimize with wasm-opt (5-15% size reduction)
 * 5. Compress with brotli at maximum quality (11)
 * 6. Embed WASM as base64 in JavaScript file
 *
 * INT4 QUANTIZATION:
 * - CodeT5 models use INT4 (4-bit weights) for 50% size reduction
 * - Only 1-2% quality loss compared to INT8
 *
 * OUTPUT:
 * - wasm-bundle/pkg/socket_ai_bg.wasm (~115MB with INT4)
 * - external/socket-ai-sync.mjs (brotli-compressed, base64-encoded WASM)
 */

import { brotliCompressSync } from 'node:zlib'
import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
 * Check if Homebrew is installed.
 */
async function checkBrewInstalled() {
  try {
    await exec('brew', ['--version'])
    return true
  } catch {
    return false
  }
}

/**
 * Install Homebrew.
 */
async function installBrew() {
  console.log('📦 Installing Homebrew...')
  console.log('   This may take a few minutes...\\n')

  try {
    const installScript =
      '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
    await exec('bash', ['-c', installScript], { stdio: 'inherit' })
    console.log('   ✓ Homebrew installed successfully\\n')
    return true
  } catch (e) {
    console.error(`   ✗ Failed to install Homebrew: ${e.message}`)
    console.error('   Please install manually: https://brew.sh/')
    return false
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
 * Install binaryen via Homebrew.
 */
async function installBinaryen() {
  console.log('📦 Installing binaryen (wasm-opt)...')

  try {
    await exec('brew', ['install', 'binaryen'], { stdio: 'inherit' })
    console.log('   ✓ binaryen installed successfully\\n')
    return true
  } catch (e) {
    console.error(`   ✗ Failed to install binaryen: ${e.message}`)
    return false
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '../..')
const wasmBundleDir = path.join(rootPath, 'wasm-bundle')
const externalDir = path.join(rootPath, 'external')

console.log('╔═══════════════════════════════════════════════════╗')
console.log('║   Build Unified WASM Bundle                       ║')
console.log('╚═══════════════════════════════════════════════════╝\n')

// Step 1: Check Rust toolchain.
console.log('Step 1: Checking Rust toolchain...\n')
const hasRust = await checkRustToolchain()
if (!hasRust) {
  console.error('❌ Rust toolchain setup failed')
  console.error('   Please install manually: https://rustup.rs/')
  process.exit(1)
}

// Step 2: Download models.
console.log('Step 2: Downloading model files...\n')
const hasModels = await downloadModels()
if (!hasModels) {
  console.error('❌ Model download incomplete')
  console.error('   Please run: node scripts/wasm/convert-codet5.mjs')
  process.exit(1)
}

// Step 2.5: Check and install binaryen for wasm-opt.
console.log('Step 2.5: Checking binaryen (wasm-opt)...\n')
const hasBinaryen = await checkBinaryenInstalled()
if (!hasBinaryen) {
  console.log('❌ binaryen (wasm-opt) not found\n')

  // Check if Homebrew is installed.
  const hasBrew = await checkBrewInstalled()
  if (!hasBrew) {
    console.log('❌ Homebrew not found\n')
    const brewInstalled = await installBrew()
    if (!brewInstalled) {
      console.error(
        '⚠ Skipping wasm-opt optimization (install manually for smaller bundle)',
      )
    }
  }

  if (hasBrew || (await checkBrewInstalled())) {
    const binaryenInstalled = await installBinaryen()
    if (!binaryenInstalled) {
      console.error(
        '⚠ Skipping wasm-opt optimization (install manually for smaller bundle)',
      )
    }
  }
} else {
  console.log('✓ binaryen (wasm-opt) found\n')
}

// Step 3: Build WASM with wasm-pack.
console.log('Step 3: Building WASM bundle...\n')

const { wasmPack } = getRustPaths()
const pkgDir = path.join(wasmBundleDir, 'pkg')

console.log('📦 Running wasm-pack build...')
console.log(`   Source: ${wasmBundleDir}`)
console.log(`   Output: ${pkgDir}\n`)

// Force wasm-pack to use rustup's toolchain by modifying PATH.
const { homedir } = await import('node:os')
const cargoHome = process.env.CARGO_HOME || path.join(homedir(), '.cargo')
const cargoBin = path.join(cargoHome, 'bin')

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
    '--release',
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      // Put cargo/bin first in PATH to prioritize rustup's toolchain.
      PATH: `${cargoBin}${path.delimiter}${process.env.PATH}`,
    },
  },
)

if (buildResult.code !== 0) {
  console.error('❌ wasm-pack build failed')
  process.exit(1)
}

console.log('✓ wasm-pack build complete\n')

// Step 4: Check size and optionally optimize.
const wasmFile = path.join(pkgDir, 'socket_ai_bg.wasm')
if (!existsSync(wasmFile)) {
  console.error(`❌ WASM file not found: ${wasmFile}`)
  process.exit(1)
}

let stats = await fs.stat(wasmFile)
const originalSize = stats.size
console.log(
  `📊 WASM bundle size: ${(originalSize / 1024 / 1024).toFixed(2)} MB`,
)

// Try to optimize with wasm-opt if available.
try {
  console.log('\n🔧 Optimizing with wasm-opt...')
  const optResult = await exec('wasm-opt', ['-Oz', wasmFile, '-o', wasmFile], {
    stdio: 'inherit',
  })

  if (optResult.code === 0) {
    stats = await fs.stat(wasmFile)
    const optimizedSize = stats.size
    const savings = ((1 - optimizedSize / originalSize) * 100).toFixed(1)
    console.log(
      `✓ Optimized size: ${(optimizedSize / 1024 / 1024).toFixed(2)} MB (${savings}% smaller)\n`,
    )
  } else {
    console.log(
      '⚠ wasm-opt optimization failed (continuing with unoptimized)\n',
    )
  }
} catch (_e) {
  console.log('⚠ wasm-opt not available (install binaryen for optimization)\n')
}

// Step 5: Embed as base64 in JavaScript.
console.log('Step 5: Embedding WASM as base64...\n')

console.log('📖 Reading WASM binary...')
const wasmData = await fs.readFile(wasmFile)
console.log(`   ✓ Read ${wasmData.length} bytes`)

console.log('🗜️  Compressing with brotli (quality 11 - maximum)...')
const { constants } = await import('node:zlib')
const wasmCompressed = brotliCompressSync(wasmData, {
  params: {
    [constants.BROTLI_PARAM_QUALITY]: 11, // Maximum quality (0-11)
    [constants.BROTLI_PARAM_SIZE_HINT]: wasmData.length,
    [constants.BROTLI_PARAM_LGWIN]: 24, // Maximum window size (10-24)
  },
})
const compressionRatio = (
  (wasmCompressed.length / wasmData.length) *
  100
).toFixed(1)
console.log(
  `   ✓ Compressed: ${wasmCompressed.length} bytes (${compressionRatio}% of original)`,
)

console.log('🔤 Encoding as base64...')
const wasmBase64 = wasmCompressed.toString('base64')
console.log(`   ✓ Encoded: ${wasmBase64.length} bytes\n`)

// Generate socket-ai-sync.mjs.
console.log('📝 Generating external/socket-ai-sync.mjs...')

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

const outputPath = path.join(externalDir, 'socket-ai-sync.mjs')
await fs.writeFile(outputPath, syncContent, 'utf-8')

console.log(`   ✓ Generated ${outputPath}`)
console.log(
  `   ✓ File size: ${(syncContent.length / 1024 / 1024).toFixed(2)} MB\n`,
)

console.log('╔═══════════════════════════════════════════════════╗')
console.log('║   Build Complete                                  ║')
console.log('╚═══════════════════════════════════════════════════╝\n')

console.log('📊 Summary:')
console.log(
  `   Original WASM: ${(wasmData.length / 1024 / 1024).toFixed(2)} MB`,
)
console.log(
  `   Compressed: ${(wasmCompressed.length / 1024 / 1024).toFixed(2)} MB`,
)
console.log(`   Base64: ${(wasmBase64.length / 1024 / 1024).toFixed(2)} MB`)
console.log(
  `\n   Total savings: ${((1 - wasmCompressed.length / wasmData.length) * 100).toFixed(1)}%`,
)
console.log('\nNext steps:')
console.log('  1. This file will be bundled into dist/cli.js by Rollup')
console.log('  2. Rollup output will be compressed to dist/cli.js.bz')
console.log('  3. Native stub or index.js will decompress and execute')
