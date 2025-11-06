/**
 * Optimize Yoga Layout WASM Before Embedding
 *
 * Optimizes Yoga Layout WASM file before embedding into the bundle.
 *
 * USAGE:
 *   node scripts/wasm/optimize-yoga.mjs
 *   node scripts/wasm/optimize-yoga.mjs --aggressive
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'


const logger = getDefaultLogger()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '../..')
const cacheDir = path.join(rootPath, '.cache/models')

const isAggressive = process.argv.includes('--aggressive')

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
    code: result.code ?? 0,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  }
}

/**
 * Check if wasm-opt is available.
 */
function checkWasmOpt() {
  try {
    const result = exec('wasm-opt', ['--version'])
    return true
  } catch {
    return false
  }
}

/**
 * Get file size in MB.
 */
async function getFileSizeMB(filePath) {
  const stats = await fs.stat(filePath)
  return (stats.size / 1024 / 1024).toFixed(2)
}

/**
 * Optimize a single WASM file.
 */
async function optimizeWasmFile(inputPath, outputPath, options = {}) {
  const { name, aggressive = false } = options

  if (!existsSync(inputPath)) {
    logger.warn(`File not found: ${inputPath}`)
    return false
  }

  const originalSize = await getFileSizeMB(inputPath)
  logger.progress(`Optimizing ${name || path.basename(inputPath)}`)
  logger.substep(`Original: ${originalSize} MB`)

  // Build optimization flags.
  const flags = [
    '-Oz', // Optimize for size
    '--enable-simd',
    '--enable-bulk-memory',
    '--enable-sign-ext',
    '--enable-mutable-globals',
    '--enable-nontrapping-float-to-int',
    '--enable-reference-types',
  ]

  if (aggressive) {
    flags.push(
      '--low-memory-unused',
      '--flatten',
      '--rereloop',
      '--vacuum',
      '--dce', // Dead code elimination
      '--remove-unused-names',
      '--remove-unused-module-elements',
      '--strip-debug',
      '--strip-dwarf',
      '--strip-producers',
      '--strip-target-features',
    )
  }

  try {
    const result = await exec('wasm-opt', [...flags, inputPath, '-o', outputPath], {
      stdio: 'pipe',
    })

    if (result.code === 0) {
      const optimizedSize = await getFileSizeMB(outputPath)
      const savings = ((1 - optimizedSize / originalSize) * 100).toFixed(1)
      logger.done(`Optimized: ${optimizedSize} MB (${savings}% smaller)`)
      return true
    }

    logger.warn('wasm-opt failed, copying original')
    await fs.copyFile(inputPath, outputPath)
    return false
  } catch (e) {
    logger.warn(`Optimization failed: ${e.message}`)
    await fs.copyFile(inputPath, outputPath)
    return false
  }
}

/**
 * Main entry point.
 */
async function main() {
  logger.step('Optimize Embedded WASM Files')

  if (isAggressive) {
    logger.substep('Mode: Aggressive (maximum optimization)')
  } else {
    logger.substep('Mode: Standard (balanced optimization)')
  }

  // Check if wasm-opt is available.
  if (!checkWasmOpt()) {
    logger.error('wasm-opt not found')
    logger.substep('Install binaryen:')
    logger.substep('  macOS:   brew install binaryen')
    logger.substep('  Linux:   sudo apt-get install binaryen')
    logger.substep('  Windows: choco install binaryen')
    process.exit(1)
  }

  // Ensure cache directory exists.
  await fs.mkdir(cacheDir, { recursive: true })

  logger.info('\nOptimizing Yoga Layout WASM:\n')

  // Yoga WASM file to optimize.
  const inputFile = path.join(cacheDir, 'yoga.wasm')
  const outputFile = path.join(cacheDir, 'yoga-optimized.wasm')

  if (!existsSync(inputFile)) {
    logger.error('Yoga WASM not found')
    logger.substep('Please run: node scripts/wasm/extract-yoga.mjs')
    process.exit(1)
  }

  const originalSize = Number.parseFloat(await getFileSizeMB(inputFile))
  await optimizeWasmFile(inputFile, outputFile, {
    aggressive: isAggressive,
    name: 'Yoga Layout',
  })
  const optimizedSize = Number.parseFloat(await getFileSizeMB(outputFile))

  // Summary.
  const totalSavings = ((1 - optimizedSize / originalSize) * 100).toFixed(1)
  logger.log('')
  logger.success('Optimization Complete')
  logger.info(`Original: ${originalSize.toFixed(2)} MB`)
  logger.info(`Optimized: ${optimizedSize.toFixed(2)} MB`)
  logger.info(`Savings: ${totalSavings}%`)
  logger.info(`\nSaved ${(originalSize - optimizedSize).toFixed(2)} MB`)
}

main().catch(e => {
  logger.error('Optimization failed:', e)
  process.exit(1)
})
