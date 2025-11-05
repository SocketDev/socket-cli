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

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
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
// Read Yoga version from package.json (matches Yoga Layout release version).
const packageJson = JSON.parse(await fs.readFile(path.join(ROOT_DIR, 'package.json'), 'utf-8'))
const YOGA_VERSION = `v${packageJson.version}`
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

  if (existsSync(YOGA_SOURCE_DIR)) {
    printStep('Yoga source already exists, skipping clone')
    await createCheckpoint('yoga-layout', 'cloned')
    return
  }

  await fs.mkdir(BUILD_DIR, { recursive: true })

  printStep(`Cloning Yoga ${YOGA_VERSION}...`)
  await spawn('git', ['clone', '--depth', '1', '--branch', YOGA_VERSION, YOGA_REPO, YOGA_SOURCE_DIR], {
    shell: WIN32,
    stdio: 'inherit',
  })

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
    '-fno-finite-math-only', // Re-enable infinity checks (Yoga needs this).
  ]

  const linkerFlags = [
    '--closure=1', // Google Closure Compiler (aggressive minification).
    '--gc-sections', // Garbage collect unused sections.
    '-flto=thin',
    '-Oz',
    '-sALLOW_MEMORY_GROWTH=1', // Dynamic memory.
    '-sASSERTIONS=0', // No runtime assertions (smaller, faster).
    '-sEXPORT_ES6=1', // ES6 module export.
    '-sFILESYSTEM=0', // No filesystem support (smaller).
    '-sINITIAL_MEMORY=64KB', // Minimal initial memory.
    '-sMALLOC=emmalloc', // Smaller allocator.
    '-sMODULARIZE=1', // Modular output.
    '-sNO_EXIT_RUNTIME=1', // Keep runtime alive (needed for WASM).
    '-sSTACK_SIZE=16KB', // Small stack.
    '-sSUPPORT_LONGJMP=0', // No longjmp (smaller).
    '-sWASM_ASYNC_COMPILATION=0', // CRITICAL: Synchronous instantiation for bundling.
  ]

  const cmakeArgs = [
    'cmake',
    `-DCMAKE_TOOLCHAIN_FILE=${toolchainFile}`,
    '-DCMAKE_BUILD_TYPE=Release',
    `-DCMAKE_CXX_FLAGS=${cxxFlags.join(' ')}`,
    `-DCMAKE_EXE_LINKER_FLAGS=${linkerFlags.join(' ')}`,
    `-DCMAKE_SHARED_LINKER_FLAGS=${linkerFlags.join(' ')}`,
    `-S`,
    YOGA_SOURCE_DIR,
    `-B`,
    cmakeBuildDir,
  ]

  printStep('Optimization flags:')
  printStep(`  CXX: ${cxxFlags.join(' ')}`)
  printStep(`  Linker: ${linkerFlags.join(' ')}`)

  await spawn('emcmake', cmakeArgs, { shell: WIN32, stdio: 'inherit' })

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

  // Build static library with CMake.
  printStep('Compiling C++ to static library...')
  await spawn('emmake', ['cmake', '--build', cmakeBuildDir, '--target', 'yogacore'], {
    shell: WIN32,
    stdio: 'inherit',
  })

  // Link WASM module with Emscripten bindings.
  printStep('Linking WASM module with Emscripten bindings...')

  const bindingsFile = path.join(__dirname, '..', 'src', 'yoga-wasm.cpp')
  const staticLib = path.join(cmakeBuildDir, 'yoga', 'libyogacore.a')
  const wasmOutput = path.join(cmakeBuildDir, 'yoga.wasm')
  const jsOutput = path.join(cmakeBuildDir, 'yoga.js')

  // Use optimization flags (note: bindings require RTTI and exceptions).
  const cxxFlags = [
    '-Oz',
    '-flto=thin',
    '-ffunction-sections',
    '-fdata-sections',
    '-ffast-math',
    '-fno-finite-math-only',
  ]

  const linkerFlags = [
    '--closure=1',
    '-Wl,--gc-sections',
    '-flto=thin',
    '-Oz',
    '-sALLOW_MEMORY_GROWTH=1',
    '-sASSERTIONS=0',
    '-sEXPORT_ES6=1',
    '-sFILESYSTEM=0',
    '-sINITIAL_MEMORY=64KB',
    '-sMALLOC=emmalloc',
    '-sMODULARIZE=1',
    '-sNO_EXIT_RUNTIME=1',
    '-sSTACK_SIZE=16KB',
    '-sSUPPORT_LONGJMP=0',
    '--bind',
  ]

  // Compile and link in one step.
  const emArgs = [
    `-I${path.join(BUILD_DIR, 'yoga-source')}`,
    ...cxxFlags,
    bindingsFile,
    staticLib,
    ...linkerFlags,
    '-o',
    jsOutput,
  ]

  await spawn('em++', emArgs, {
    shell: WIN32,
    stdio: 'inherit',
  })

  printSuccess(`JS glue code created: ${jsOutput}`)
  printSuccess(`WASM module created: ${wasmOutput}`)

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
  const wasmFile = path.join(cmakeBuildDir, 'yoga.wasm')

  if (!existsSync(wasmFile)) {
    printError(`WASM file not found: ${wasmFile}`)
    throw new Error('Cannot optimize - WASM file missing from build')
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
  ]

  // Find wasm-opt in Emscripten SDK or system PATH.
  // Emscripten SDK has wasm-opt in: $EMSDK/upstream/bin/wasm-opt
  let wasmOptCmd = 'wasm-opt'
  if (process.env.EMSDK) {
    const emsdkWasmOpt = path.join(process.env.EMSDK, 'upstream', 'bin', 'wasm-opt')
    if (existsSync(emsdkWasmOpt)) {
      wasmOptCmd = emsdkWasmOpt
      printStep(`Using wasm-opt from EMSDK: ${wasmOptCmd}`)
    }
  }

  const result = await spawn(wasmOptCmd, [...wasmOptFlags, wasmFile, '-o', wasmFile], {
    shell: WIN32,
    stdio: 'inherit',
  })
  if (result.code !== 0) {
    throw new Error(`wasm-opt failed with exit code ${result.code}`)
  }

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
  const wasmFile = path.join(cmakeBuildDir, 'yoga.wasm')

  if (!existsSync(wasmFile)) {
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
  const wasmFile = path.join(cmakeBuildDir, 'yoga.wasm')
  const jsFile = path.join(cmakeBuildDir, 'yoga.js')

  if (!existsSync(wasmFile)) {
    printError('WASM file not found - build failed')
    throw new Error(`Required WASM file not found: ${wasmFile}`)
  }

  const outputWasm = path.join(OUTPUT_DIR, 'yoga.wasm')
  const outputJs = path.join(OUTPUT_DIR, 'yoga.js')

  // Copy WASM file.
  await fs.copyFile(wasmFile, outputWasm)

  // Copy JS glue code and strip export statement.
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

  printHeader('🔨 Building yoga-layout')
  const logger = getDefaultLogger()
  logger.info(`Yoga Layout ${YOGA_VERSION} minimal build`)
  logger.info('')

  // Clean checkpoints if requested or if output is missing.
  const outputWasm = path.join(OUTPUT_DIR, 'yoga.wasm')
  const outputJs = path.join(OUTPUT_DIR, 'yoga.js')
  const outputMissing = !existsSync(outputWasm) || !existsSync(outputJs)

  if (CLEAN_BUILD || outputMissing) {
    if (outputMissing) {
      printStep('Output artifacts missing - cleaning stale checkpoints')
    }
    await cleanCheckpoint('yoga-layout')
  }

  // Pre-flight checks.
  printHeader('Pre-flight Checks')

  const diskOk = await checkDiskSpace(BUILD_DIR, 1)
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
