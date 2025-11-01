/**
 * Optimize Third-Party WASM Files Before Embedding
 *
 * Optimizes ONNX Runtime, Yoga Layout, and other WASM files
 * BEFORE they're embedded into the unified bundle.
 *
 * This is where the real savings happen - optimizing the 95% of
 * the bundle that's pre-built third-party code.
 *
 * USAGE:
 *   node scripts/wasm/optimize-embedded-wasm.mjs
 *   node scripts/wasm/optimize-embedded-wasm.mjs --aggressive
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

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
    getDefaultLogger().warn(`File not found: ${inputPath}`)
    return false
  }

  const originalSize = await getFileSizeMB(inputPath)
  getDefaultLogger().progress(`Optimizing ${name || path.basename(inputPath)}`)
  getDefaultLogger().substep(`Original: ${originalSize} MB`)

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
      getDefaultLogger().done(`Optimized: ${optimizedSize} MB (${savings}% smaller)`)
      return true
    }

    getDefaultLogger().warn('wasm-opt failed, copying original')
    await fs.copyFile(inputPath, outputPath)
    return false
  } catch (e) {
    getDefaultLogger().warn(`Optimization failed: ${e.message}`)
    await fs.copyFile(inputPath, outputPath)
    return false
  }
}

/**
 * Main entry point.
 */
async function main() {
  getDefaultLogger().step('Optimize Embedded WASM Files')

  if (isAggressive) {
    getDefaultLogger().substep('Mode: Aggressive (maximum optimization)')
  } else {
    getDefaultLogger().substep('Mode: Standard (balanced optimization)')
  }

  // Check if wasm-opt is available.
  if (!checkWasmOpt()) {
    getDefaultLogger().error('wasm-opt not found')
    getDefaultLogger().substep('Install binaryen:')
    getDefaultLogger().substep('  macOS:   brew install binaryen')
    getDefaultLogger().substep('  Linux:   sudo apt-get install binaryen')
    getDefaultLogger().substep('  Windows: choco install binaryen')
    process.exit(1)
  }

  // Ensure cache directory exists.
  await fs.mkdir(cacheDir, { recursive: true })

  getDefaultLogger().info('\nOptimizing third-party WASM files:\n')

  let totalOriginal = 0
  let totalOptimized = 0

  // List of WASM files to optimize.
  const wasmFiles = [
    {
      input: path.join(cacheDir, 'ort-wasm-simd.wasm'),
      name: 'ONNX Runtime (SIMD only)',
      output: path.join(cacheDir, 'ort-wasm-simd-optimized.wasm'),
    },
    {
      input: path.join(cacheDir, 'yoga.wasm'),
      name: 'Yoga Layout',
      output: path.join(cacheDir, 'yoga-optimized.wasm'),
    },
  ]

  // Optimize each file.
  for (const file of wasmFiles) {
    if (!existsSync(file.input)) {
      getDefaultLogger().warn(`Skipping ${file.name} (not found)`)
      continue
    }

    const originalSize = Number.parseFloat(await getFileSizeMB(file.input))
    await optimizeWasmFile(file.input, file.output, {
      aggressive: isAggressive,
      name: file.name,
    })
    const optimizedSize = Number.parseFloat(await getFileSizeMB(file.output))

    totalOriginal += originalSize
    totalOptimized += optimizedSize

    getDefaultLogger().log('') // Spacing.
  }

  // Summary.
  if (totalOriginal > 0) {
    const totalSavings = ((1 - totalOptimized / totalOriginal) * 100).toFixed(1)
    getDefaultLogger().success('Optimization Complete')
    getDefaultLogger().info(`Total original: ${totalOriginal.toFixed(2)} MB`)
    getDefaultLogger().info(`Total optimized: ${totalOptimized.toFixed(2)} MB`)
    getDefaultLogger().info(`Total savings: ${totalSavings}%`)
    getDefaultLogger().info(
      `\nSaved ${(totalOriginal - totalOptimized).toFixed(2)} MB across all files`,
    )
  }

  getDefaultLogger().info('\nNext steps:')
  getDefaultLogger().info('1. Update Rust code to use optimized files')
  getDefaultLogger().info('2. Rebuild WASM bundle: pnpm wasm:build')
}

main().catch(e => {
  getDefaultLogger().error('Optimization failed:', e)
  process.exit(1)
})
