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
import { safeDelete } from '@socketsecurity/lib/fs'
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
// Read ONNX Runtime version from package.json (matches ONNX Runtime release version).
const packageJson = JSON.parse(await fs.readFile(path.join(ROOT_DIR, 'package.json'), 'utf-8'))
const ONNX_VERSION = `v${packageJson.version}`
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

  // Check if source exists and if it has the patches.
  if (existsSync(ONNX_SOURCE_DIR)) {
    printStep('ONNX Runtime source already exists')

    const depsPath = path.join(ONNX_SOURCE_DIR, 'cmake', 'deps.txt')
    const cmakePath = path.join(ONNX_SOURCE_DIR, 'cmake', 'onnxruntime_webassembly.cmake')
    const depsContent = await fs.readFile(depsPath, 'utf-8')
    const cmakeContent = await fs.readFile(cmakePath, 'utf-8')

    // Check if patches have been applied.
    const eigenPatched = depsContent.includes('51982be81bbe52572b54180454df11a3ece9a934')
    const cmakePatched = cmakeContent.includes('# add_compile_definitions(\n  #   BUILD_MLAS_NO_ONNXRUNTIME')

    if (!eigenPatched || !cmakePatched) {
      // Source exists but patches not applied - need to re-clone.
      printWarning('Source exists but patches not applied')
      printStep('Removing old source to re-clone with patches...')
      await fs.rm(ONNX_SOURCE_DIR, { recursive: true, force: true })
      printSuccess('Old source removed')
    } else {
      printStep('All patches already applied, skipping clone')
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

  // Patch deps.txt to accept current Eigen hash from GitLab.
  // GitLab changed the archive format, causing hash mismatch.
  printStep('Patching deps.txt to accept current Eigen hash...')
  const depsPath = path.join(ONNX_SOURCE_DIR, 'cmake', 'deps.txt')
  const depsContent = await fs.readFile(depsPath, 'utf-8')
  const updatedDeps = depsContent.replace(
    /eigen;([^;]+);5ea4d05e62d7f954a46b3213f9b2535bdd866803/g,
    'eigen;$1;51982be81bbe52572b54180454df11a3ece9a934'
  )
  await fs.writeFile(depsPath, updatedDeps, 'utf-8')
  printSuccess('Eigen hash updated in deps.txt')

  // Patch onnxruntime_webassembly.cmake to comment out BUILD_MLAS_NO_ONNXRUNTIME.
  // When threading is disabled, BUILD_MLAS_NO_ONNXRUNTIME causes MLFloat16 errors.
  printStep('Patching onnxruntime_webassembly.cmake to fix MLFloat16 build...')
  const cmakePath = path.join(ONNX_SOURCE_DIR, 'cmake', 'onnxruntime_webassembly.cmake')
  const cmakeContent = await fs.readFile(cmakePath, 'utf-8')
  const updatedCmake = cmakeContent.replace(
    /add_compile_definitions\(\s*BUILD_MLAS_NO_ONNXRUNTIME\s*\)/,
    '# add_compile_definitions(\n  #   BUILD_MLAS_NO_ONNXRUNTIME\n  # )'
  )
  await fs.writeFile(cmakePath, updatedCmake, 'utf-8')
  printSuccess('BUILD_MLAS_NO_ONNXRUNTIME commented out in cmake')

  // Clear CMake cache to ensure patch is picked up.
  printStep('Clearing CMake cache to force reconfiguration...')
  const platform = process.platform === 'darwin' ? 'Darwin' : 'Linux'
  const cmakeCachePath = path.join(ONNX_SOURCE_DIR, 'build', platform, 'Release', 'CMakeCache.txt')
  if (existsSync(cmakeCachePath)) {
    await safeDelete(cmakeCachePath)
    printSuccess('CMake cache cleared')
  }

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

  // Note: WASM_ASYNC_COMPILATION=0 is required for bundling but causes compilation
  // errors when passed via EMCC_CFLAGS (it's a linker flag, not compiler flag).
  // ONNX Runtime's build system handles Emscripten settings through CMake.
  // We pass it through --emscripten_settings which goes to EMSCRIPTEN_SETTINGS.

  // Enable WASM threading to avoid MLFloat16 build errors.
  // Issue: https://github.com/microsoft/onnxruntime/issues/23769
  // When threading is disabled, BUILD_MLAS_NO_ONNXRUNTIME is defined, which causes
  // MLFloat16 to be missing Negate(), IsNegative(), and FromBits() methods.
  // Workaround (if threading can't be used): Comment out BUILD_MLAS_NO_ONNXRUNTIME
  // in cmake/onnxruntime_webassembly.cmake after cloning.
  await spawn(buildScript, [
    '--config', 'Release',
    '--build_wasm',
    '--skip_tests',
    '--parallel',
    // '--enable_wasm_threads', // Commented out as fallback to get build working.
    '--cmake_extra_defines', 'onnxruntime_EMSCRIPTEN_SETTINGS=WASM_ASYNC_COMPILATION=0;EXPORT_ES6=1',
  ], {
    cwd: ONNX_SOURCE_DIR,
    shell: WIN32,
    stdio: 'inherit',
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
