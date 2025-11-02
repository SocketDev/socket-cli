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

  // Patch 1: Update Eigen hash (see docs/patches.md).
  printStep('Patching deps.txt to accept current Eigen hash...')
  const depsPath = path.join(ONNX_SOURCE_DIR, 'cmake', 'deps.txt')
  const depsContent = await fs.readFile(depsPath, 'utf-8')
  const updatedDeps = depsContent.replace(
    /eigen;([^;]+);5ea4d05e62d7f954a46b3213f9b2535bdd866803/g,
    'eigen;$1;51982be81bbe52572b54180454df11a3ece9a934'
  )
  await fs.writeFile(depsPath, updatedDeps, 'utf-8')
  printSuccess('Eigen hash updated in deps.txt')

  // Patch 2: Fix MLFloat16 build (see docs/patches.md).
  printStep('Patching onnxruntime_webassembly.cmake to fix MLFloat16 build...')
  const cmakePath = path.join(ONNX_SOURCE_DIR, 'cmake', 'onnxruntime_webassembly.cmake')
  let cmakeContent = await fs.readFile(cmakePath, 'utf-8')
  cmakeContent = cmakeContent.replace(
    /add_compile_definitions\(\s*BUILD_MLAS_NO_ONNXRUNTIME\s*\)/,
    '# add_compile_definitions(\n  #   BUILD_MLAS_NO_ONNXRUNTIME\n  # )'
  )
  await fs.writeFile(cmakePath, cmakeContent, 'utf-8')
  printSuccess('BUILD_MLAS_NO_ONNXRUNTIME commented out')

  // Patch 3: Modern Emscripten compatibility (see docs/patches.md).
  //
  // PROBLEM: ONNX Runtime's wasm_post_build.js expects specific Worker URL pattern
  // from older Emscripten versions. Modern Emscripten (3.1.50+) doesn't generate
  // this pattern, causing build to fail with "Unexpected number of matches" error.
  //
  // SOLUTION: Patch the script to handle modern Emscripten gracefully:
  // 1. Allow zero matches (modern Emscripten generates correct code already)
  // 2. Improve error message to show actual match count
  //
  // CACHE HANDLING: CMake copies wasm_post_build.js from source to build directory
  // during configuration. GitHub Actions may restore cached builds with old unpatched
  // copies, so we must:
  // 1. Patch source file (single source of truth)
  // 2. Delete cached build copy if present (forces CMake recopy from patched source)
  // 3. Clear CMake cache (ensures full reconfiguration)
  printStep('Patching wasm_post_build.js to handle modern Emscripten...')
  const postBuildSourcePath = path.join(ONNX_SOURCE_DIR, 'js', 'web', 'script', 'wasm_post_build.js')
  if (existsSync(postBuildSourcePath)) {
    let postBuildContent = await fs.readFile(postBuildSourcePath, 'utf-8')

    // Patch 1: Allow zero matches (modern Emscripten case).
    // Insert early return when no Worker URL pattern found.
    postBuildContent = postBuildContent.replace(
      /if \(matches\.length !== 1\) \{/,
      `if (matches.length === 0) {\n      console.log('No Worker URL pattern found - skipping post-build transformation (modern Emscripten)');\n      return;\n    }\n    if (matches.length !== 1) {`
    )

    // Patch 2: Improve error message to show actual match count.
    // Helps debug if we get unexpected pattern variations.
    postBuildContent = postBuildContent.replace(
      /Unexpected number of matches for "" in "": \./,
      `Unexpected number of Worker URL matches: found \${matches.length}, expected 1. Pattern: \${regex}`
    )

    await fs.writeFile(postBuildSourcePath, postBuildContent, 'utf-8')
    printSuccess('wasm_post_build.js (source) patched')
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

  // Clean stale cached files before build.
  // GitHub Actions may have restored old unpatched files from cache after clone step.
  // Delete them now to force CMake to recopy patched versions from source.
  printStep('Checking for stale cached build files...')
  const platform = process.platform === 'darwin' ? 'Darwin' : 'Linux'
  const buildCacheDir = path.join(ONNX_SOURCE_DIR, 'build', platform, 'Release')

  // Delete cached wasm_post_build.js (CMake will recopy from patched source).
  const postBuildBuildPath = path.join(buildCacheDir, 'wasm_post_build.js')
  if (existsSync(postBuildBuildPath)) {
    await safeDelete(postBuildBuildPath)
    printSuccess('Removed stale wasm_post_build.js from cache')
  }

  // Clear CMake cache to force full reconfiguration.
  const cmakeCachePath = path.join(buildCacheDir, 'CMakeCache.txt')
  if (existsSync(cmakeCachePath)) {
    await safeDelete(cmakeCachePath)
    printSuccess('Cleared CMake cache')
  }

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
    '--enable_wasm_threads', // Required for ONNX Runtime v1.19.0+ (non-threaded builds deprecated).
    '--enable_wasm_simd', // Enable SIMD for better performance.
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

  // Look for threaded WASM files (threading + SIMD enabled).
  // With threading enabled, outputs are: ort-wasm-simd-threaded.{wasm,mjs}.
  const wasmFile = path.join(buildOutputDir, 'ort-wasm-simd-threaded.wasm')
  const jsFile = path.join(buildOutputDir, 'ort-wasm-simd-threaded.mjs')

  if (!existsSync(wasmFile)) {
    printError('WASM file not found - build failed')
    printError(`Expected: ${wasmFile}`)
    throw new Error(`Required WASM file not found: ${wasmFile}`)
  }

  const outputWasm = path.join(OUTPUT_DIR, 'ort-wasm-simd-threaded.wasm')
  const outputJs = path.join(OUTPUT_DIR, 'ort-wasm-simd-threaded.mjs')

  // Copy WASM file.
  await fs.copyFile(wasmFile, outputWasm)

  // Copy JS glue code (ES6 module format with threading).
  if (existsSync(jsFile)) {
    await fs.copyFile(jsFile, outputJs)
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
  getDefaultLogger().info(`ONNX Runtime ${ONNX_VERSION} build for Socket CLI`)
  getDefaultLogger().info('')

  // Clean checkpoints if requested or if output is missing.
  const outputWasm = path.join(OUTPUT_DIR, 'ort-wasm-simd-threaded.wasm')
  const outputJs = path.join(OUTPUT_DIR, 'ort-wasm-simd-threaded.mjs')
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
  getDefaultLogger().success(`Total time: ${totalDuration}`)
  getDefaultLogger().success(`Output: ${OUTPUT_DIR}`)
  getDefaultLogger().info('')
  getDefaultLogger().info('Next steps:')
  getDefaultLogger().info('  1. Test WASM with Socket CLI')
  getDefaultLogger().info('  2. Run extract-onnx-runtime.mjs to embed WASM')
  getDefaultLogger().info('')
}

// Run build.
main().catch((e) => {
  printError('Build Failed')
  getDefaultLogger().error(e.message)
  throw e
})
