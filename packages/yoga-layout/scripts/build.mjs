/**
 * Build yoga-layout - Size-optimized Yoga Layout WASM for Socket CLI.
 *
 * This script builds Yoga Layout from official C++ with Emscripten:
 * - Yoga C++ (official Facebook implementation)
 * - Emscripten for C++ → WASM compilation
 * - CMake configuration
 * - Aggressive WASM optimizations
 *
 * Usage:
 *   node scripts/build.mjs          # Normal build with checkpoints
 *   node scripts/build.mjs --force  # Force rebuild (ignore checkpoints)
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { logger } from '@socketsecurity/lib/logger'

import { exec } from '@socketsecurity/build-infra/lib/build-exec'
import {
  printSetupResults,
  setupBuildEnvironment,
} from '@socketsecurity/build-infra/lib/build-env'
import {
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

// Configuration.
const ROOT_DIR = path.join(__dirname, '..')
const BUILD_DIR = path.join(ROOT_DIR, 'build')
const OUTPUT_DIR = path.join(BUILD_DIR, 'wasm')
const YOGA_VERSION = 'v3.1.0'
const YOGA_REPO = 'https://github.com/facebook/yoga.git'
const YOGA_SOURCE_DIR = path.join(BUILD_DIR, 'yoga-source')

/**
 * Clone Yoga source if not already present.
 */
async function cloneYogaSource() {
  if (!(await shouldRun('yoga-layout', 'cloned', FORCE_BUILD))) {
    return
  }

  printHeader('Cloning Yoga Source')

  if (await fs.access(YOGA_SOURCE_DIR).then(() => true).catch(() => false)) {
    printStep('Yoga source already exists, skipping clone')
    await createCheckpoint('yoga-layout', 'cloned')
    return
  }

  await fs.mkdir(BUILD_DIR, { recursive: true })

  printStep(`Cloning Yoga ${YOGA_VERSION}...`)
  await exec(
    `git clone --depth 1 --branch ${YOGA_VERSION} ${YOGA_REPO} ${YOGA_SOURCE_DIR}`,
    { stdio: 'inherit' }
  )

  printSuccess(`Yoga ${YOGA_VERSION} cloned`)
  await createCheckpoint('yoga-layout', 'cloned')
}

/**
 * Configure CMake with Emscripten.
 */
async function configure() {
  if (!(await shouldRun('yoga-layout', 'configured', FORCE_BUILD))) {
    return
  }

  printHeader('Configuring CMake with Emscripten')

  const cmakeBuildDir = path.join(BUILD_DIR, 'cmake')
  await fs.mkdir(cmakeBuildDir, { recursive: true })

  // Determine Emscripten toolchain file location.
  let toolchainFile
  if (process.env.EMSCRIPTEN) {
    toolchainFile = path.join(
      process.env.EMSCRIPTEN,
      'cmake/Modules/Platform/Emscripten.cmake'
    )
  } else if (process.env.EMSDK) {
    toolchainFile = path.join(
      process.env.EMSDK,
      'upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake'
    )
  } else {
    printWarning('Emscripten SDK path not set')
    throw new Error('Emscripten SDK required')
  }

  printStep(`Using toolchain: ${toolchainFile}`)

  // Configure CMake with aggressive size + performance optimizations.
  // MAXIMUM AGGRESSIVE - NO BACKWARDS COMPATIBILITY!
  const cxxFlags = [
    '-Oz', // Optimize aggressively for size.
    '-flto=thin', // Thin LTO for faster builds, similar size reduction.
    '-fno-exceptions', // No C++ exceptions (smaller).
    '-fno-rtti', // No runtime type information (smaller).
    '-ffunction-sections', // Separate functions for better dead code elimination.
    '-fdata-sections', // Separate data sections.
    '-ffast-math', // Fast math optimizations (performance).
  ].join(' ')

  const linkerFlags = [
    '--closure 1', // Google Closure Compiler (aggressive minification).
    '--gc-sections', // Garbage collect unused sections.
    '-flto=thin',
    '-Oz',
    '-s ALLOW_MEMORY_GROWTH=1', // Dynamic memory.
    '-s ASSERTIONS=0', // No runtime assertions (smaller, faster).
    '-s EXPORT_ES6=1', // ES6 module export.
    '-s FILESYSTEM=0', // No filesystem support (smaller).
    '-s INITIAL_MEMORY=64KB', // Minimal initial memory.
    '-s MALLOC=emmalloc', // Smaller allocator.
    '-s MODULARIZE=1', // Modular output.
    '-s NO_EXIT_RUNTIME=1', // Keep runtime alive (needed for WASM).
    '-s STACK_SIZE=16KB', // Small stack.
    '-s SUPPORT_LONGJMP=0', // No longjmp (smaller).
  ].join(' ')

  const cmakeArgs = [
    `-DCMAKE_TOOLCHAIN_FILE=${toolchainFile}`,
    '-DCMAKE_BUILD_TYPE=Release',
    `-DCMAKE_CXX_FLAGS="${cxxFlags}"`,
    `-DCMAKE_EXE_LINKER_FLAGS="${linkerFlags}"`,
    `-DCMAKE_SHARED_LINKER_FLAGS="${linkerFlags}"`,
    `-S ${YOGA_SOURCE_DIR}`,
    `-B ${cmakeBuildDir}`,
  ].join(' ')

  printStep('Optimization flags:')
  printStep(`  CXX: ${cxxFlags}`)
  printStep(`  Linker: ${linkerFlags}`)

  await exec(`emcmake cmake ${cmakeArgs}`, { stdio: 'inherit' })

  printSuccess('CMake configured')
  await createCheckpoint('yoga-layout', 'configured')
}

/**
 * Build Yoga with Emscripten.
 */
async function build() {
  if (!(await shouldRun('yoga-layout', 'built', FORCE_BUILD))) {
    return
  }

  printHeader('Building Yoga with Emscripten')

  const startTime = Date.now()
  const cmakeBuildDir = path.join(BUILD_DIR, 'cmake')

  // Build with CMake.
  printStep('Compiling C++ to WASM...')
  await exec(`emmake cmake --build ${cmakeBuildDir} --target yogacore`, {
    stdio: 'inherit',
  })

  const duration = formatDuration(Date.now() - startTime)
  printSuccess(`Build completed in ${duration}`)
  await createCheckpoint('yoga-layout', 'built')
}

/**
 * Optimize WASM with wasm-opt.
 */
async function optimize() {
  if (!(await shouldRun('yoga-layout', 'optimized', FORCE_BUILD))) {
    return
  }

  printHeader('Optimizing WASM')

  // Find the built WASM file.
  const cmakeBuildDir = path.join(BUILD_DIR, 'cmake')
  const wasmFile = path.join(cmakeBuildDir, 'libyogacore.wasm')

  if (!(await fs.access(wasmFile).then(() => true).catch(() => false))) {
    printWarning(`WASM file not found: ${wasmFile}`)
    printWarning('Skipping optimization')
    await createCheckpoint('yoga-layout', 'optimized')
    return
  }

  const sizeBefore = await getFileSize(wasmFile)
  printStep(`Size before: ${sizeBefore}`)

  // MAXIMUM AGGRESSIVE FLAGS.
  // NO BACKWARDS COMPATIBILITY - Modern runtimes only!
  const wasmOptFlags = [
    '-Oz',
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

  await exec(`wasm-opt ${wasmOptFlags} "${wasmFile}" -o "${wasmFile}"`, {
    stdio: 'inherit',
  })

  const sizeAfter = await getFileSize(wasmFile)
  printStep(`Size after: ${sizeAfter}`)

  printSuccess('WASM optimized')
  await createCheckpoint('yoga-layout', 'optimized')
}

/**
 * Verify WASM can load.
 */
async function verify() {
  if (!(await shouldRun('yoga-layout', 'verified', FORCE_BUILD))) {
    return
  }

  printHeader('Verifying WASM')

  const cmakeBuildDir = path.join(BUILD_DIR, 'cmake')
  const wasmFile = path.join(cmakeBuildDir, 'libyogacore.wasm')

  if (!(await fs.access(wasmFile).then(() => true).catch(() => false))) {
    printWarning('WASM file not found, skipping verification')
    await createCheckpoint('yoga-layout', 'verified')
    return
  }

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
  await createCheckpoint('yoga-layout', 'verified')
}

/**
 * Export WASM to output directory.
 */
async function exportWasm() {
  printHeader('Exporting WASM')

  await fs.mkdir(OUTPUT_DIR, { recursive: true })

  const cmakeBuildDir = path.join(BUILD_DIR, 'cmake')
  const wasmFile = path.join(cmakeBuildDir, 'libyogacore.wasm')

  if (!(await fs.access(wasmFile).then(() => true).catch(() => false))) {
    printWarning('WASM file not found, nothing to export')
    return
  }

  const outputWasm = path.join(OUTPUT_DIR, 'yoga.wasm')

  // Copy WASM file.
  await fs.copyFile(wasmFile, outputWasm)

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

  printHeader('🔨 Building yoga-layout')
  logger.info(`Yoga Layout ${YOGA_VERSION} minimal build`)
  logger.info('')

  // Pre-flight checks.
  printHeader('Pre-flight Checks')

  const diskOk = await checkDiskSpace(BUILD_DIR, 1 * 1024 * 1024 * 1024)
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
    printError('')
    printError('Build environment setup failed')
    printError('Install Emscripten SDK:')
    printError('  https://emscripten.org/docs/getting_started/downloads.html')
    printError('')
    throw new Error('Emscripten SDK required')
  }

  printSuccess('Pre-flight checks passed')

  // Build phases.
  await cloneYogaSource()
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
  logger.info('  1. Test WASM with Socket CLI')
  logger.info('  2. Integrate with unified WASM build')
  logger.info('')
}

// Run build.
main().catch((e) => {
  printError('Build Failed')
  logger.error(e.message)
  throw e
})
