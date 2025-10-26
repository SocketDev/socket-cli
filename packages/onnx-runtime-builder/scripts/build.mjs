/**
 * Build onnx-runtime - Minimal ONNX Runtime WASM for CodeT5 models.
 *
 * This script builds ONNX Runtime from source with:
 * - Minimal operator set (only ops required by CodeT5)
 * - Aggressive WASM optimizations
 * - Size-optimized Emscripten build
 *
 * Usage:
 *   node scripts/build.mjs          # Normal build with checkpoints
 *   node scripts/build.mjs --force  # Force rebuild (ignore checkpoints)
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { logger } from '@socketsecurity/lib/logger'

import { exec, execCapture } from '@socketsecurity/build-infra/lib/build-exec'
import {
  printSetupResults,
  setupBuildEnvironment,
} from '@socketsecurity/build-infra/lib/build-env'
import { EmscriptenBuilder } from '@socketsecurity/build-infra/lib/emscripten-builder'
import {
  checkCompiler,
  checkDiskSpace,
  checkPythonVersion,
  formatDuration,
  getFileSize,
} from '@socketsecurity/build-infra/lib/build-helpers'
import {
  printError,
  printHeader,
  printStep,
  printSuccess,
} from '@socketsecurity/build-infra/lib/build-output'
import {
  cleanCheckpoint,
  createCheckpoint,
  shouldRun,
} from '@socketsecurity/build-infra/lib/checkpoint-manager'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Parse arguments.
const args = process.argv.slice(2)
const FORCE_BUILD = args.includes('--force')

// Configuration.
const ONNX_VERSION = 'v1.20.1'
const ROOT_DIR = path.join(__dirname, '..')
const SOURCE_DIR = path.join(ROOT_DIR, '.onnx-source')
const BUILD_DIR = path.join(ROOT_DIR, 'build')
const OUTPUT_DIR = path.join(BUILD_DIR, 'wasm')

// Required operators for CodeT5 models.
const REQUIRED_OPS = [
  'Add',
  'Cast',
  'Concat',
  'Div',
  'Dropout',
  'Gather',
  'Gemm',
  'LayerNormalization',
  'MatMul',
  'Mul',
  'ReduceMean',
  'Reshape',
  'Shape',
  'Slice',
  'Softmax',
  'Split',
  'Squeeze',
  'Sub',
  'Tanh',
  'Transpose',
  'Unsqueeze',
]

/**
 * Clone ONNX Runtime source.
 */
async function cloneSource() {
  if (!(await shouldRun('onnx-runtime', 'cloned', FORCE_BUILD))) {
    return
  }

  printHeader('Cloning ONNX Runtime Source')
  printStep(`Version: ${ONNX_VERSION}`)
  printStep('Repository: https://github.com/microsoft/onnxruntime.git')

  await exec(
    `git clone --depth 1 --branch ${ONNX_VERSION} --recursive https://github.com/microsoft/onnxruntime.git ${SOURCE_DIR}`,
    { stdio: 'inherit' }
  )

  printSuccess('ONNX Runtime source cloned')
  await createCheckpoint('onnx-runtime', 'cloned', { version: ONNX_VERSION })
}

/**
 * Generate required operators configuration.
 */
async function generateOpsConfig() {
  if (!(await shouldRun('onnx-runtime', 'ops-configured', FORCE_BUILD))) {
    return
  }

  printHeader('Generating Required Operators Config')

  const opsConfigPath = path.join(BUILD_DIR, 'required_operators.config')
  const opsConfig = REQUIRED_OPS.join('\n') + '\n'

  await fs.mkdir(BUILD_DIR, { recursive: true })
  await fs.writeFile(opsConfigPath, opsConfig, 'utf8')

  printStep(`Operators: ${REQUIRED_OPS.length}`)
  printStep(`Config: ${opsConfigPath}`)

  printSuccess('Required operators configuration created')
  await createCheckpoint('onnx-runtime', 'ops-configured')
}

/**
 * Configure ONNX Runtime build.
 */
async function configure() {
  if (!(await shouldRun('onnx-runtime', 'configured', FORCE_BUILD))) {
    return
  }

  printHeader('Configuring ONNX Runtime Build')

  const emscripten = new EmscriptenBuilder(SOURCE_DIR, BUILD_DIR)

  await emscripten.configureCMake({
    CMAKE_BUILD_TYPE: 'MinSizeRel',
    onnxruntime_BUILD_WEBASSEMBLY: 'ON',
    onnxruntime_ENABLE_WEBASSEMBLY_THREADS: 'OFF',
    onnxruntime_MINIMAL_BUILD: 'ON',
    onnxruntime_DISABLE_EXCEPTIONS: 'ON',
    onnxruntime_DISABLE_RTTI: 'ON',
    onnxruntime_REDUCE_OPS_BUILD: 'ON',
    onnxruntime_BUILD_UNIT_TESTS: 'OFF',
  })

  printSuccess('Configuration complete')
  await createCheckpoint('onnx-runtime', 'configured')
}

/**
 * Build ONNX Runtime WASM.
 */
async function build() {
  if (!(await shouldRun('onnx-runtime', 'built', FORCE_BUILD))) {
    return
  }

  printHeader('Building ONNX Runtime WASM')

  const startTime = Date.now()

  const emscripten = new EmscriptenBuilder(SOURCE_DIR, BUILD_DIR)
  await emscripten.buildWithCMake({ parallel: true, target: 'onnxruntime' })

  const duration = formatDuration(Date.now() - startTime)
  printSuccess(`Build completed in ${duration}`)
  await createCheckpoint('onnx-runtime', 'built')
}

/**
 * Optimize WASM with wasm-opt.
 */
async function optimize() {
  if (!(await shouldRun('onnx-runtime', 'optimized', FORCE_BUILD))) {
    return
  }

  printHeader('Optimizing WASM')

  const wasmFile = path.join(BUILD_DIR, 'onnxruntime-web.wasm')

  if (!(await fs.access(wasmFile).then(() => true).catch(() => false))) {
    throw new Error(`WASM file not found: ${wasmFile}`)
  }

  const sizeBefore = await getFileSize(wasmFile)
  printStep(`Size before: ${sizeBefore}`)

  const emscripten = new EmscriptenBuilder(SOURCE_DIR, BUILD_DIR)
  await emscripten.optimize('onnxruntime-web.wasm', {
    optimizeLevel: 4,
    shrinkLevel: 2,
  })

  const sizeAfter = await getFileSize(wasmFile)
  printStep(`Size after: ${sizeAfter}`)

  printSuccess('WASM optimized')
  await createCheckpoint('onnx-runtime', 'optimized')
}

/**
 * Verify WASM can load.
 */
async function verify() {
  if (!(await shouldRun('onnx-runtime', 'verified', FORCE_BUILD))) {
    return
  }

  printHeader('Verifying WASM')

  const wasmFile = path.join(BUILD_DIR, 'onnxruntime-web.wasm')

  // Check WASM file exists and is valid.
  const stats = await fs.stat(wasmFile)
  if (stats.size === 0) {
    throw new Error('WASM file is empty')
  }

  // Verify WASM magic number.
  const buffer = await fs.readFile(wasmFile)
  const magic = buffer.slice(0, 4).toString('hex')
  if (magic !== '0061736d') {
    throw new Error('Invalid WASM file (bad magic number)')
  }

  printSuccess('WASM verified')
  await createCheckpoint('onnx-runtime', 'verified')
}

/**
 * Export WASM to output directory.
 */
async function exportWasm() {
  printHeader('Exporting WASM')

  await fs.mkdir(OUTPUT_DIR, { recursive: true })

  const wasmFile = path.join(BUILD_DIR, 'onnxruntime-web.wasm')
  const jsFile = path.join(BUILD_DIR, 'onnxruntime-web.js')

  const outputWasm = path.join(OUTPUT_DIR, 'onnxruntime-web.wasm')
  const outputJs = path.join(OUTPUT_DIR, 'onnxruntime-web.js')

  await fs.copyFile(wasmFile, outputWasm)

  if (await fs.access(jsFile).then(() => true).catch(() => false)) {
    await fs.copyFile(jsFile, outputJs)
  }

  const size = await getFileSize(outputWasm)
  printStep(`WASM: ${outputWasm}`)
  printStep(`Size: ${size}`)

  printSuccess('WASM exported')
}

/**
 * Main build function.
 */
async function main() {
  const totalStart = Date.now()

  printHeader('🔨 Building onnx-runtime')
  logger.info(`ONNX Runtime ${ONNX_VERSION} minimal build`)
  logger.info('')

  // Pre-flight checks.
  printHeader('Pre-flight Checks')

  const diskOk = await checkDiskSpace(BUILD_DIR, 3 * 1024 * 1024 * 1024)
  if (!diskOk) {
    throw new Error('Insufficient disk space (need 3GB)')
  }

  const pythonOk = await checkPythonVersion('3.8')
  if (!pythonOk) {
    throw new Error('Python 3.8+ required')
  }

  // Setup build environment (check for Emscripten SDK).
  const envSetup = await setupBuildEnvironment({
    emscripten: true,
    autoSetup: false,
  })

  printSetupResults(envSetup)

  if (!envSetup.success) {
    // Fallback: Check if emcc is in PATH (e.g., Homebrew installation).
    printStep('Checking for emcc in PATH...')
    const emccCheck = await checkCompiler('emcc')

    if (emccCheck) {
      printSuccess('Emscripten (emcc) found in PATH')
    } else {
      printError('')
      printError('Build environment setup failed')
      printError('Install Emscripten SDK:')
      printError('  https://emscripten.org/docs/getting_started/downloads.html')
      printError('')
      throw new Error('Emscripten SDK required')
    }
  }

  printSuccess('Pre-flight checks passed')

  // Build phases.
  await cloneSource()
  await generateOpsConfig()
  await configure()
  await build()
  await optimize()
  await verify()
  await exportWasm()

  // Report completion.
  const totalDuration = formatDuration(Date.now() - totalStart)

  printHeader('🎉 Build Complete!')
  logger.success(`Total time: ${totalDuration}`)
  logger.success(`Output: ${OUTPUT_DIR}`)
  logger.info('')
  logger.info('Next steps:')
  logger.info('  1. Test WASM with CodeT5 models')
  logger.info('  2. Integrate with Socket CLI build')
  logger.info('')
}

// Run build.
main().catch((e) => {
  printError('Build Failed', e)
  throw e
})
