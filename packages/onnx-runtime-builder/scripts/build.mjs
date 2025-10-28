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
const CLEAN_BUILD = args.includes('--clean')

// Configuration.
const ONNX_VERSION = 'v1.23.2'
const ROOT_DIR = path.join(__dirname, '..')
const SOURCE_DIR = path.join(ROOT_DIR, '.onnx-source')
const BUILD_DIR = path.join(ROOT_DIR, 'build')
const OUTPUT_DIR = path.join(ROOT_DIR, 'dist')

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

  // Check if source directory already exists (shouldn't happen after checkpoint cleanup).
  if (existsSync(SOURCE_DIR)) {
    printStep(`Source directory already exists: ${SOURCE_DIR}`)
    const { rm } = await import('node:fs/promises')
    await rm(SOURCE_DIR, { recursive: true, force: true })
    printStep('Removed existing source directory')
  }

  const result = await spawn(
    'git',
    [
      'clone',
      '--depth',
      '1',
      '--branch',
      ONNX_VERSION,
      '--recursive',
      'https://github.com/microsoft/onnxruntime.git',
      SOURCE_DIR,
    ],
    { stdio: 'inherit', shell: WIN32 }
  )
  if (result.code !== 0) {
    throw new Error(`git clone failed with exit code ${result.code}`)
  }

  // Verify source directory and build.sh exist.
  if (!existsSync(SOURCE_DIR)) {
    throw new Error(`Source directory not created: ${SOURCE_DIR}`)
  }

  const buildScript = path.join(SOURCE_DIR, 'build.sh')
  if (!existsSync(buildScript)) {
    printError(`build.sh not found at: ${buildScript}`)
    printStep('Listing source directory contents:')
    try {
      const { readdir } = await import('node:fs/promises')
      const files = await readdir(SOURCE_DIR)
      printStep(`Files in ${SOURCE_DIR}: ${files.join(', ')}`)
    } catch (e) {
      printError(`Could not read directory: ${e.message}`)
    }
    throw new Error(`build.sh not found after clone: ${buildScript}`)
  }

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
 * Build ONNX Runtime WASM using build.sh script.
 */
async function build() {
  if (!(await shouldRun('onnx-runtime', 'built', FORCE_BUILD))) {
    return
  }

  printHeader('Building ONNX Runtime WASM')

  const startTime = Date.now()

  // ONNX Runtime uses a custom build.sh script, not direct CMake.
  // Build with minimal size optimizations for CodeT5 inference.
  const buildScript = path.join(SOURCE_DIR, 'build.sh')

  printStep('Running build.sh with minimal build configuration...')
  printStep('This will take 20-30 minutes')

  const result = await spawn(
    buildScript,
    [
      '--config',
      'MinSizeRel',
      '--build_wasm',
      '--skip_tests',
      '--disable_wasm_exception_catching',
      '--disable_rtti',
      '--minimal_build',
      '--build_dir',
      BUILD_DIR,
    ],
    { cwd: SOURCE_DIR, shell: WIN32, stdio: 'inherit' }
  )

  if (result.code !== 0) {
    throw new Error(`ONNX Runtime build.sh failed with exit code ${result.code}`)
  }

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

  // ONNX Runtime build.sh creates files in MinSizeRel subdirectory.
  const buildOutputDir = path.join(BUILD_DIR, 'MinSizeRel')

  // Find the WASM file - it could be onnxruntime-web.wasm or ort-wasm.wasm.
  let wasmFile = path.join(buildOutputDir, 'onnxruntime-web.wasm')
  if (!existsSync(wasmFile)) {
    wasmFile = path.join(buildOutputDir, 'ort-wasm.wasm')
  }
  if (!existsSync(wasmFile)) {
    // Try finding it recursively in the build directory.
    printStep('Searching for WASM files in build directory...')
    const result = await spawn('find', [buildOutputDir, '-name', '*.wasm', '-type', 'f'], {
      shell: WIN32,
      stdio: 'pipe',
      stdioString: true,
    })

    if (result.stdout) {
      const wasmFiles = result.stdout.trim().split('\n').filter(Boolean)
      if (wasmFiles.length > 0) {
        printStep(`Found WASM files: ${wasmFiles.join(', ')}`)
        wasmFile = wasmFiles[0] // Use first found WASM file.
      }
    }

    if (!existsSync(wasmFile)) {
      throw new Error(`WASM file not found in build directory: ${buildOutputDir}`)
    }
  }

  printStep(`WASM file: ${wasmFile}`)
  const sizeBefore = await getFileSize(wasmFile)
  printStep(`Size before: ${sizeBefore}`)

  const wasmBasename = path.basename(wasmFile)
  const wasmDir = path.dirname(wasmFile)

  const emscripten = new EmscriptenBuilder(SOURCE_DIR, wasmDir)
  await emscripten.optimize(wasmBasename, {
    optimizeLevel: 4,
    shrinkLevel: 2,
  })

  const sizeAfter = await getFileSize(wasmFile)
  printStep(`Size after: ${sizeAfter}`)

  printSuccess('WASM optimized')
  await createCheckpoint('onnx-runtime', 'optimized', { wasmFile })
}

/**
 * Verify WASM can load.
 */
async function verify() {
  if (!(await shouldRun('onnx-runtime', 'verified', FORCE_BUILD))) {
    return
  }

  printHeader('Verifying WASM')

  // Get WASM file location from optimize checkpoint.
  const { getCheckpointData } = await import('@socketsecurity/build-infra/lib/checkpoint-manager')
  const checkpoint = await getCheckpointData('onnx-runtime', 'optimized')
  const wasmFile = checkpoint?.wasmFile || path.join(BUILD_DIR, 'MinSizeRel', 'onnxruntime-web.wasm')

  if (!existsSync(wasmFile)) {
    throw new Error(`WASM file not found: ${wasmFile}`)
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
  await createCheckpoint('onnx-runtime', 'verified', { wasmFile })
}

/**
 * Export WASM to output directory.
 */
async function exportWasm() {
  printHeader('Exporting WASM')

  await fs.mkdir(OUTPUT_DIR, { recursive: true })

  // Get WASM file location from verified checkpoint.
  const { getCheckpointData } = await import('@socketsecurity/build-infra/lib/checkpoint-manager')
  const checkpoint = await getCheckpointData('onnx-runtime', 'verified')
  const wasmFile = checkpoint?.wasmFile || path.join(BUILD_DIR, 'MinSizeRel', 'onnxruntime-web.wasm')

  if (!existsSync(wasmFile)) {
    throw new Error(`WASM file not found: ${wasmFile}`)
  }

  // Look for accompanying JS file in the same directory.
  const wasmDir = path.dirname(wasmFile)
  const wasmBasename = path.basename(wasmFile, '.wasm')
  const jsFile = path.join(wasmDir, `${wasmBasename}.js`)

  const outputWasm = path.join(OUTPUT_DIR, 'onnxruntime-web.wasm')
  const outputJs = path.join(OUTPUT_DIR, 'onnxruntime-web.js')

  await fs.copyFile(wasmFile, outputWasm)

  if (existsSync(jsFile)) {
    await fs.copyFile(jsFile, outputJs)
    printStep(`JS: ${outputJs}`)
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

  // Clean checkpoints if requested or if output/source is missing.
  const outputWasm = path.join(OUTPUT_DIR, 'onnxruntime-web.wasm')
  const buildScript = path.join(SOURCE_DIR, 'build.sh')
  const artifactsMissing = !existsSync(outputWasm) || !existsSync(buildScript)

  if (CLEAN_BUILD || artifactsMissing) {
    if (artifactsMissing) {
      printStep('Output artifacts or source missing - cleaning stale checkpoints')
    }
    await cleanCheckpoint('onnx-runtime')
  }

  // Pre-flight checks.
  printHeader('Pre-flight Checks')

  const diskOk = await checkDiskSpace(BUILD_DIR, 3)
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
