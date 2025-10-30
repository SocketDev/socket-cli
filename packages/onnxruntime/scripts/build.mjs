/**
 * Build onnxruntime - Size-optimized ONNX Runtime WASM for Socket CLI.
 *
 * This script builds ONNX Runtime from official source with Emscripten:
 * - ONNX Runtime C++ (official Microsoft implementation)
 * - Emscripten for C++ → WASM compilation
 * - CMake configuration
 * - Aggressive WASM optimizations
 *
 * Usage:
 *   node scripts/build.mjs          # Normal build with checkpoints
 *   node scripts/build.mjs --force  # Force rebuild (ignore checkpoints)
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { logger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'
import {
  printSetupResults,
  setupBuildEnvironment,
} from '@socketsecurity/build-infra/lib/build-env'
import {
  checkCompiler,
  checkDiskSpace,
  formatDuration,
  getFileSize,
} from '@socketsecurity/build-infra/lib/build-helpers'
import {
  printError,
  printHeader,
  printStep,
  printSuccess,
  printWarning,
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
const CLEAN_BUILD = args.includes('--clean')

// Configuration.
const ROOT_DIR = path.join(__dirname, '..')
const BUILD_DIR = path.join(ROOT_DIR, 'build')
const OUTPUT_DIR = path.join(BUILD_DIR, 'wasm')
const ONNX_VERSION = 'v1.21.1'
const ONNX_REPO = 'https://github.com/microsoft/onnxruntime.git'
const ONNX_SOURCE_DIR = path.join(BUILD_DIR, 'onnxruntime-source')

/**
 * Clone ONNX Runtime source if not already present.
 */
async function cloneOnnxSource() {
  if (!(await shouldRun('onnxruntime', 'cloned', FORCE_BUILD))) {
    return
  }

  printHeader('Cloning ONNX Runtime Source')

  // Check if source exists and if it has the patch.
  if (existsSync(ONNX_SOURCE_DIR)) {
    printStep('ONNX Runtime source already exists')

    const eigenCmakePath = path.join(ONNX_SOURCE_DIR, 'cmake', 'external', 'eigen.cmake')
    const eigenCmake = await fs.readFile(eigenCmakePath, 'utf-8')

    if (!eigenCmake.includes('32b145f525a8308d7ab1c09388b2e288312d8eba')) {
      // Source exists but patch not applied - need to re-clone.
      printWarning('Source exists but Eigen patch not applied')
      printStep('Removing old source to re-clone with patch...')
      await fs.rm(ONNX_SOURCE_DIR, { recursive: true, force: true })
      printSuccess('Old source removed')
    } else {
      printStep('Eigen hash already patched, skipping clone')
      await createCheckpoint('onnxruntime', 'cloned')
      return
    }
  }

  await fs.mkdir(BUILD_DIR, { recursive: true })

  printStep(`Cloning ONNX Runtime ${ONNX_VERSION}...`)
  await spawn('git', ['clone', '--depth', '1', '--branch', ONNX_VERSION, ONNX_REPO, ONNX_SOURCE_DIR], {
    shell: WIN32,
    stdio: 'inherit',
  })
  printSuccess(`ONNX Runtime ${ONNX_VERSION} cloned`)

  // Patch eigen.cmake immediately after cloning.
  printStep('Patching eigen.cmake to accept current Eigen hash...')
  const eigenCmakePath = path.join(ONNX_SOURCE_DIR, 'cmake', 'external', 'eigen.cmake')
  const eigenCmake = await fs.readFile(eigenCmakePath, 'utf-8')
  const updatedEigenCmake = eigenCmake.replace(
    /URL_HASH SHA1=be8be39fdbc6e60e94fa7870b280707069b5b81a/g,
    'URL_HASH SHA1=32b145f525a8308d7ab1c09388b2e288312d8eba'
  )
  await fs.writeFile(eigenCmakePath, updatedEigenCmake, 'utf-8')
  printSuccess('Eigen hash updated')

  await createCheckpoint('onnxruntime', 'cloned')
}

/**
 * Build ONNX Runtime with Emscripten using official build script.
 */
async function build() {
  if (!(await shouldRun('onnxruntime', 'built', FORCE_BUILD))) {
    return
  }

  printHeader('Building ONNX Runtime with Emscripten')

  const startTime = Date.now()

  // ONNX Runtime has its own build script: ./build.sh --config Release --build_wasm
  // We need to pass WASM_ASYNC_COMPILATION=0 via EMCC_CFLAGS environment variable.

  printStep('Running ONNX Runtime build script...')
  printStep('This may take 30-60 minutes on first build...')

  const buildScript = path.join(ONNX_SOURCE_DIR, 'build.sh')

  // Set Emscripten flags for synchronous WASM compilation.
  const env = {
    ...process.env,
    EMCC_CFLAGS: '-sWASM_ASYNC_COMPILATION=0',
  }

  await spawn(buildScript, [
    '--config', 'Release',
    '--build_wasm',
    '--skip_tests',
    '--parallel',
  ], {
    cwd: ONNX_SOURCE_DIR,
    shell: WIN32,
    stdio: 'inherit',
    env,
  })

  const duration = formatDuration(Date.now() - startTime)
  printSuccess(`Build completed in ${duration}`)
  await createCheckpoint('onnxruntime', 'built')
}

/**
 * Export WASM to output directory.
 */
async function exportWasm() {
  printHeader('Exporting WASM')

  await fs.mkdir(OUTPUT_DIR, { recursive: true })

  // ONNX Runtime build outputs to: build/Linux/Release/
  // or build/Darwin/Release/ on macOS
  const platform = process.platform === 'darwin' ? 'Darwin' : 'Linux'
  const buildOutputDir = path.join(ONNX_SOURCE_DIR, 'build', platform, 'Release')

  const wasmFile = path.join(buildOutputDir, 'ort-wasm-simd-threaded.wasm')
  const jsFile = path.join(buildOutputDir, 'ort-wasm-simd-threaded.js')

  if (!existsSync(wasmFile)) {
    printError('WASM file not found - build failed')
    printError(`Expected: ${wasmFile}`)
    throw new Error(`Required WASM file not found: ${wasmFile}`)
  }

  const outputWasm = path.join(OUTPUT_DIR, 'ort-wasm-simd-threaded.wasm')
  const outputJs = path.join(OUTPUT_DIR, 'ort-wasm-simd-threaded.js')

  // Copy WASM file.
  await fs.copyFile(wasmFile, outputWasm)

  // Copy JS glue code and strip export statement if present.
  if (existsSync(jsFile)) {
    const jsContent = await fs.readFile(jsFile, 'utf-8')
    // Strip the export statement at the end of the file.
    const withoutExport = jsContent.replace(/;?\s*export\s+default\s+\w+\s*;\s*$/, '')
    await fs.writeFile(outputJs, withoutExport, 'utf-8')
    printStep(`JS: ${outputJs}`)
  }

  const wasmSize = await getFileSize(outputWasm)
  printStep(`WASM: ${outputWasm}`)
  printStep(`WASM size: ${wasmSize}`)

  printSuccess('WASM exported')
}

/**
 * Main build function.
 */
async function main() {
  const totalStart = Date.now()

  printHeader('🔨 Building onnxruntime')
  logger.info(`ONNX Runtime ${ONNX_VERSION} build for Socket CLI`)
  logger.info('')

  // Clean checkpoints if requested or if output is missing.
  const outputWasm = path.join(OUTPUT_DIR, 'ort-wasm-simd-threaded.wasm')
  const outputJs = path.join(OUTPUT_DIR, 'ort-wasm-simd-threaded.js')
  const outputMissing = !existsSync(outputWasm) || !existsSync(outputJs)

  if (CLEAN_BUILD || outputMissing) {
    if (outputMissing) {
      printStep('Output artifacts missing - cleaning stale checkpoints')
    }
    await cleanCheckpoint('onnxruntime')
  }

  // Pre-flight checks.
  printHeader('Pre-flight Checks')

  const diskOk = await checkDiskSpace(BUILD_DIR, 5) // ONNX needs more space.
  if (!diskOk) {
    printWarning('Could not check disk space')
  }

  // Setup build environment (check for Emscripten SDK).
  const envSetup = await setupBuildEnvironment({
    emscripten: true,
    autoSetup: false,
  })

  printSetupResults(envSetup)

  if (!envSetup.success) {
    // Fallback: Check if emcc is in PATH.
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
  await cloneOnnxSource()
  await build()
  await exportWasm()

  // Report completion.
  const totalDuration = formatDuration(Date.now() - totalStart)

  printHeader('🎉 Build Complete!')
  logger.success(`Total time: ${totalDuration}`)
  logger.success(`Output: ${OUTPUT_DIR}`)
  logger.info('')
  logger.info('Next steps:')
  logger.info('  1. Test WASM with Socket CLI')
  logger.info('  2. Run extract-onnx-runtime.mjs to embed WASM')
  logger.info('')
}

// Run build.
main().catch((e) => {
  printError('Build Failed')
  logger.error(e.message)
  throw e
})
