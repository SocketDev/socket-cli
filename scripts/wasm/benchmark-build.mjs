/**
 * Benchmark WASM Build Performance
 *
 * Measures and compares build times for dev vs production builds.
 * Helps validate optimization improvements.
 *
 * USAGE:
 *   node scripts/wasm/benchmark-build.mjs
 *   node scripts/wasm/benchmark-build.mjs --dev-only
 *   node scripts/wasm/benchmark-build.mjs --prod-only
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const buildScript = path.join(__dirname, 'build-unified-wasm.mjs')

/**
 * Format time duration.
 */
function formatTime(ms) {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`
  }
  return `${seconds}s`
}

/**
 * Get file size.
 */
async function getFileSize(filePath) {
  if (!existsSync(filePath)) {
    return 0
  }
  const stats = await fs.stat(filePath)
  return stats.size
}

/**
 * Run build and measure time.
 */
async function benchmarkBuild(mode) {
  getDefaultLogger().step(`Benchmarking ${mode} build`)

  const args = ['node', buildScript]
  if (mode === 'dev') {
    args.push('--dev')
  }

  const startTime = performance.now()

  try {
    const result = await spawn(args[0], args.slice(1), {
      stdio: 'inherit',
      stdioString: true,
    })

    if (result.code !== 0) {
      throw new Error(`Build failed with exit code ${result.code}`)
    }
  } catch (e) {
    getDefaultLogger().error(`${mode} build failed:`, e.message)
    return null
  }

  const endTime = performance.now()
  const duration = endTime - startTime

  getDefaultLogger().success(`${mode} build completed in ${formatTime(duration)}`)

  return {
    duration,
    durationMs: duration,
    durationFormatted: formatTime(duration),
    mode,
  }
}

/**
 * Get WASM file sizes.
 */
async function getWasmSizes() {
  const rootPath = path.join(__dirname, '../..')
  const wasmFile = path.join(
    rootPath,
    'build/wasm-bundle/pkg/socket_ai_bg.wasm',
  )
  const syncFile = path.join(rootPath, 'external/socket-ai-sync.mjs')

  const wasmSize = await getFileSize(wasmFile)
  const syncSize = await getFileSize(syncFile)

  return {
    syncSize,
    wasmSize,
  }
}

/**
 * Display comparison.
 */
function displayComparison(devResult, prodResult) {
  getDefaultLogger().step('Build Performance Comparison')

  getDefaultLogger().log('')
  getDefaultLogger().log('╔════════════════════════════════════════════════════╗')
  getDefaultLogger().log('║             Build Time Comparison                 ║')
  getDefaultLogger().log('╚════════════════════════════════════════════════════╝')
  getDefaultLogger().log('')

  const devTime = devResult.durationMs / 1000
  const prodTime = prodResult.durationMs / 1000
  const speedup = (prodTime / devTime).toFixed(1)

  getDefaultLogger().log(`  Dev Build:   ${devResult.durationFormatted}`)
  getDefaultLogger().log(`  Prod Build:  ${prodResult.durationFormatted}`)
  getDefaultLogger().log('')
  getDefaultLogger().log(`  Speedup:     ${speedup}x faster (dev vs prod)`)
  getDefaultLogger().log('')

  // Visualization.
  const maxBar = 50
  const devBar = Math.floor((devTime / prodTime) * maxBar)
  const prodBar = maxBar

  getDefaultLogger().log('  Dev  │' + '█'.repeat(devBar))
  getDefaultLogger().log('  Prod │' + '█'.repeat(prodBar))
  getDefaultLogger().log('')
}

/**
 * Display size information.
 */
async function displaySizes() {
  const sizes = await getWasmSizes()

  if (sizes.wasmSize === 0 || sizes.syncSize === 0) {
    getDefaultLogger().warn('Could not read WASM file sizes')
    return
  }

  getDefaultLogger().log('╔════════════════════════════════════════════════════╗')
  getDefaultLogger().log('║             Output Size Information                ║')
  getDefaultLogger().log('╚════════════════════════════════════════════════════╝')
  getDefaultLogger().log('')

  const wasmMB = (sizes.wasmSize / 1024 / 1024).toFixed(2)
  const syncMB = (sizes.syncSize / 1024 / 1024).toFixed(2)
  const compressionRatio = (
    (sizes.syncSize / sizes.wasmSize) *
    100
  ).toFixed(1)

  getDefaultLogger().log(`  WASM (raw):        ${wasmMB} MB`)
  getDefaultLogger().log(`  JS (compressed):   ${syncMB} MB`)
  getDefaultLogger().log(`  Compression:       ${compressionRatio}% of original`)
  getDefaultLogger().log('')
}

/**
 * Main entry point.
 */
async function main() {
  const args = process.argv.slice(2)
  const devOnly = args.includes('--dev-only')
  const prodOnly = args.includes('--prod-only')

  getDefaultLogger().info('╔════════════════════════════════════════════════════╗')
  getDefaultLogger().info('║      WASM Build Performance Benchmark              ║')
  getDefaultLogger().info('╚════════════════════════════════════════════════════╝\n')

  let devResult = null
  let prodResult = null

  // Run dev build.
  if (!prodOnly) {
    devResult = await benchmarkBuild('dev')
    if (!devResult) {
      process.exit(1)
    }
  }

  // Run prod build.
  if (!devOnly) {
    if (devResult) {
      getDefaultLogger().log('') // Spacing.
    }
    prodResult = await benchmarkBuild('production')
    if (!prodResult) {
      process.exit(1)
    }
  }

  // Display comparison.
  getDefaultLogger().log('')
  if (devResult && prodResult) {
    displayComparison(devResult, prodResult)
  } else if (devResult) {
    getDefaultLogger().success(`Dev build: ${devResult.durationFormatted}`)
  } else if (prodResult) {
    getDefaultLogger().success(`Production build: ${prodResult.durationFormatted}`)
  }

  // Display sizes.
  await displaySizes()

  getDefaultLogger().info('Benchmark complete')
}

main().catch(e => {
  getDefaultLogger().error('Benchmark failed:', e)
  process.exit(1)
})
