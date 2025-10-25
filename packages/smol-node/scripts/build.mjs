/**
 * Build smol-node - Custom Node.js with Socket patches and optimizations.
 *
 * This script builds Node.js from source with:
 * - Socket security patches
 * - Size optimizations (V8 Lite Mode, no ICU, aggressive flags)
 * - Brotli compression for built-in modules
 * - Code signing for macOS ARM64
 *
 * Usage:
 *   node scripts/build.mjs          # Normal build with checkpoints
 *   node scripts/build.mjs --force  # Force rebuild (ignore checkpoints)
 */

import { promises as fs } from 'node:fs'
import { cpus, platform } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { logger } from '@socketsecurity/lib/logger'

import { CMakeBuilder } from '@socketsecurity/build-infra/lib/cmake-builder'
import { exec, execCapture } from '@socketsecurity/build-infra/lib/build-exec'
import {
  checkCompiler,
  checkDiskSpace,
  checkPythonVersion,
  estimateBuildTime,
  formatDuration,
  getFileSize,
  smokeTestBinary,
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
  hasCheckpoint,
  shouldRun,
} from '@socketsecurity/build-infra/lib/checkpoint-manager'
import {
  applyPatchDirectory,
  validatePatch,
} from '@socketsecurity/build-infra/lib/patch-validator'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Parse arguments.
const args = process.argv.slice(2)
const FORCE_BUILD = args.includes('--force')

// Configuration.
const NODE_VERSION = 'v24.10.0'
const ROOT_DIR = path.join(__dirname, '..')
const SOURCE_DIR = path.join(ROOT_DIR, '.node-source')
const BUILD_DIR = path.join(ROOT_DIR, 'build')
const PATCHES_DIR = path.join(ROOT_DIR, 'patches', 'socket')
const OUTPUT_DIR = path.join(BUILD_DIR, 'out', 'Release')

const CPU_COUNT = cpus().length
const IS_MACOS = platform() === 'darwin'
const ARCH = process.arch

/**
 * Clone Node.js source.
 */
async function cloneSource() {
  if (!(await shouldRun('smol-node', 'cloned', FORCE_BUILD))) {
    return
  }

  printHeader('Cloning Node.js Source')
  printStep(`Version: ${NODE_VERSION}`)
  printStep('Repository: https://github.com/nodejs/node.git')

  await exec(
    `git clone --depth 1 --branch ${NODE_VERSION} https://github.com/nodejs/node.git ${SOURCE_DIR}`,
    { stdio: 'inherit' }
  )

  printSuccess('Node.js source cloned')
  await createCheckpoint('smol-node', 'cloned', { version: NODE_VERSION })
}

/**
 * Apply Socket patches.
 */
async function applyPatches() {
  if (!(await shouldRun('smol-node', 'patched', FORCE_BUILD))) {
    return
  }

  printHeader('Applying Socket Patches')

  await applyPatchDirectory(PATCHES_DIR, SOURCE_DIR, { validate: true })

  printSuccess('All patches applied')
  await createCheckpoint('smol-node', 'patched')
}

/**
 * Configure Node.js build.
 */
async function configure() {
  if (!(await shouldRun('smol-node', 'configured', FORCE_BUILD))) {
    return
  }

  printHeader('Configuring Node.js Build')

  const configureFlags = [
    `--dest-cpu=${ARCH}`,
    '--with-intl=none',
    '--with-icu-source=none',
    '--without-npm',
    '--without-corepack',
    '--without-inspector',
    '--without-amaro',
    '--without-sqlite',
    '--without-node-snapshot',
    '--without-node-code-cache',
    '--v8-disable-object-print',
    '--without-node-options',
    '--disable-single-executable-application',
    '--v8-lite-mode',
    '--enable-lto',
  ]

  await exec(`./configure ${configureFlags.join(' ')}`, {
    cwd: SOURCE_DIR,
    stdio: 'inherit',
  })

  printSuccess('Configuration complete')
  await createCheckpoint('smol-node', 'configured')
}

/**
 * Build Node.js.
 */
async function build() {
  if (!(await shouldRun('smol-node', 'built', FORCE_BUILD))) {
    return
  }

  printHeader('Building Node.js')

  const timeEstimate = estimateBuildTime(30, CPU_COUNT)
  printStep(`Estimated time: ~${timeEstimate} minutes`)
  printStep(`Using ${CPU_COUNT} CPU cores`)

  const startTime = Date.now()

  await exec(`make -j${CPU_COUNT}`, {
    cwd: SOURCE_DIR,
    stdio: 'inherit',
  })

  const duration = formatDuration(Date.now() - startTime)
  printSuccess(`Build completed in ${duration}`)
  await createCheckpoint('smol-node', 'built')
}

/**
 * Optimize binary (strip debug symbols, code sign).
 */
async function optimize() {
  if (!(await shouldRun('smol-node', 'optimized', FORCE_BUILD))) {
    return
  }

  printHeader('Optimizing Binary')

  const nodeBinary = path.join(SOURCE_DIR, 'out', 'Release', 'node')

  // Strip debug symbols.
  printStep('Stripping debug symbols')
  const sizeBefore = await getFileSize(nodeBinary)
  printStep(`Size before: ${sizeBefore}`)

  await exec(`strip --strip-all ${nodeBinary}`)

  const sizeAfter = await getFileSize(nodeBinary)
  printStep(`Size after: ${sizeAfter}`)

  // Code sign for macOS ARM64.
  if (IS_MACOS && ARCH === 'arm64') {
    printStep('Code signing for macOS ARM64')
    await exec(`codesign --sign - --force ${nodeBinary}`)
  }

  printSuccess('Binary optimized')
  await createCheckpoint('smol-node', 'optimized')
}

/**
 * Verify binary functionality.
 */
async function verify() {
  if (!(await shouldRun('smol-node', 'verified', FORCE_BUILD))) {
    return
  }

  printHeader('Verifying Binary')

  const nodeBinary = path.join(SOURCE_DIR, 'out', 'Release', 'node')

  const passed = await smokeTestBinary(nodeBinary, ['--version'])

  if (!passed) {
    throw new Error('Binary verification failed')
  }

  // Test JavaScript execution.
  printStep('Testing JavaScript execution')
  await exec(
    `PKG_EXECPATH=PKG_INVOKE_NODEJS ${nodeBinary} -e "console.log('✓ JavaScript works')"`,
    { stdio: 'inherit' }
  )

  printSuccess('Binary verified')
  await createCheckpoint('smol-node', 'verified')
}

/**
 * Export binary to output directory.
 */
async function exportBinary() {
  printHeader('Exporting Binary')

  const nodeBinary = path.join(SOURCE_DIR, 'out', 'Release', 'node')
  await fs.mkdir(OUTPUT_DIR, { recursive: true })

  const outputBinary = path.join(OUTPUT_DIR, 'node')
  await fs.copyFile(nodeBinary, outputBinary)

  const size = await getFileSize(outputBinary)
  printStep(`Binary: ${outputBinary}`)
  printStep(`Size: ${size}`)

  printSuccess('Binary exported')
}

/**
 * Main build function.
 */
async function main() {
  const totalStart = Date.now()

  printHeader('🔨 Building smol-node')
  logger.info(`Node.js ${NODE_VERSION} with Socket patches`)
  logger.info('')

  // Pre-flight checks.
  printHeader('Pre-flight Checks')

  const diskOk = await checkDiskSpace(BUILD_DIR, 5 * 1024 * 1024 * 1024)
  if (!diskOk) {
    throw new Error('Insufficient disk space (need 5GB)')
  }

  const pythonOk = await checkPythonVersion('3.8')
  if (!pythonOk) {
    throw new Error('Python 3.8+ required')
  }

  const compilerOk = await checkCompiler('clang++')
  if (!compilerOk) {
    throw new Error('C++ compiler not found')
  }

  printSuccess('Pre-flight checks passed')

  // Build phases.
  await cloneSource()
  await applyPatches()
  await configure()
  await build()
  await optimize()
  await verify()
  await exportBinary()

  // Report completion.
  const totalDuration = formatDuration(Date.now() - totalStart)

  printHeader('🎉 Build Complete!')
  logger.success(`Total time: ${totalDuration}`)
  logger.success(`Output: ${path.join(OUTPUT_DIR, 'node')}`)
  logger.info('')
  logger.info('Next steps:')
  logger.info('  1. Test: PKG_EXECPATH=PKG_INVOKE_NODEJS ./build/out/Release/node --version')
  logger.info('  2. Integrate with Socket CLI build')
  logger.info('')
}

// Run build.
main().catch((e) => {
  printError('Build Failed', e)
  throw e
})
