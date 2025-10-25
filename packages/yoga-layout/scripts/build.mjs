/**
 * Build yoga-layout - Size-optimized Yoga Layout WASM for Socket CLI.
 *
 * This script builds Yoga Layout from source with:
 * - Minimal feature set for terminal rendering
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

import { exec } from '@socketsecurity/build-infra/lib/build-exec'
import { EmscriptenBuilder } from '@socketsecurity/build-infra/lib/emscripten-builder'
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
const YOGA_VERSION = 'v3.1.0'
const ROOT_DIR = path.join(__dirname, '..')
const SOURCE_DIR = path.join(ROOT_DIR, '.yoga-source')
const BUILD_DIR = path.join(ROOT_DIR, 'build')
const OUTPUT_DIR = path.join(BUILD_DIR, 'wasm')

/**
 * Clone Yoga Layout source.
 */
async function cloneSource() {
  if (!(await shouldRun('yoga-layout', 'cloned', FORCE_BUILD))) {
    return
  }

  printHeader('Cloning Yoga Layout Source')
  printStep(`Version: ${YOGA_VERSION}`)
  printStep('Repository: https://github.com/facebook/yoga.git')

  await exec(
    `git clone --depth 1 --branch ${YOGA_VERSION} https://github.com/facebook/yoga.git ${SOURCE_DIR}`,
    { stdio: 'inherit' }
  )

  printSuccess('Yoga Layout source cloned')
  await createCheckpoint('yoga-layout', 'cloned', { version: YOGA_VERSION })
}

/**
 * Configure Yoga Layout build.
 */
async function configure() {
  if (!(await shouldRun('yoga-layout', 'configured', FORCE_BUILD))) {
    return
  }

  printHeader('Configuring Yoga Layout Build')

  const emscripten = new EmscriptenBuilder(SOURCE_DIR, BUILD_DIR)

  await emscripten.configureCMake({
    CMAKE_BUILD_TYPE: 'MinSizeRel',
    BUILD_SHARED_LIBS: 'OFF',
    YOGA_ENABLE_LOGGING: 'OFF',
  })

  printSuccess('Configuration complete')
  await createCheckpoint('yoga-layout', 'configured')
}

/**
 * Build Yoga Layout WASM.
 */
async function build() {
  if (!(await shouldRun('yoga-layout', 'built', FORCE_BUILD))) {
    return
  }

  printHeader('Building Yoga Layout WASM')

  const startTime = Date.now()

  const emscripten = new EmscriptenBuilder(SOURCE_DIR, BUILD_DIR)
  await emscripten.buildWithCMake({ parallel: true, target: 'yogacore' })

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

  const wasmFile = path.join(BUILD_DIR, 'yoga.wasm')

  if (!(await fs.access(wasmFile).then(() => true).catch(() => false))) {
    throw new Error(`WASM file not found: ${wasmFile}`)
  }

  const sizeBefore = await getFileSize(wasmFile)
  printStep(`Size before: ${sizeBefore}`)

  const emscripten = new EmscriptenBuilder(SOURCE_DIR, BUILD_DIR)
  await emscripten.optimize('yoga.wasm', {
    optimizeLevel: 4,
    shrinkLevel: 2,
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

  const wasmFile = path.join(BUILD_DIR, 'yoga.wasm')

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

  const wasmFile = path.join(BUILD_DIR, 'yoga.wasm')
  const jsFile = path.join(BUILD_DIR, 'yoga.js')

  const outputWasm = path.join(OUTPUT_DIR, 'yoga.wasm')
  const outputJs = path.join(OUTPUT_DIR, 'yoga.js')

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

  printHeader('🔨 Building yoga-layout')
  logger.info(`Yoga Layout ${YOGA_VERSION} minimal build`)
  logger.info('')

  // Pre-flight checks.
  printHeader('Pre-flight Checks')

  const diskOk = await checkDiskSpace(BUILD_DIR, 1 * 1024 * 1024 * 1024)
  if (!diskOk) {
    throw new Error('Insufficient disk space (need 1GB)')
  }

  // Check for Emscripten.
  if (!process.env.EMSDK) {
    printError('Emscripten SDK not found', 'Set EMSDK environment variable')
    throw new Error('Emscripten SDK required')
  }

  printSuccess('Pre-flight checks passed')

  // Build phases.
  await cloneSource()
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
  logger.info('  2. Integrate with Socket CLI build')
  logger.info('')
}

// Run build.
main().catch((e) => {
  printError('Build Failed', e)
  throw e
})
