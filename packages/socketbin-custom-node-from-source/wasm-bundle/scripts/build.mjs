#!/usr/bin/env node
/**
 * Build script for Socket AI unified WASM bundle.
 *
 * Creates optimized WASM bundle with embedded models:
 * - MiniLM INT4 (17 MB)
 * - CodeT5 INT4 (90 MB)
 * - ONNX Runtime SIMD (3 MB)
 * - Yoga Layout (95 KB)
 *
 * Directory structure:
 * - build/ - Work in progress (cargo target, intermediate files)
 * - dist/  - Final production build
 *
 * Usage:
 *   node scripts/build.mjs [options]
 *
 * Options:
 *   --no-models    Build without embedding models (fast, for testing)
 *   --clean        Clean build and dist directories before building
 *   --help         Show this help message
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PACKAGE_ROOT = path.resolve(__dirname, '..')
const BUILD_DIR = path.join(PACKAGE_ROOT, 'build')
const DIST_DIR = path.join(PACKAGE_ROOT, 'dist')
const TARGET_DIR = path.join(PACKAGE_ROOT, 'target')

// Parse command line arguments.
const args = process.argv.slice(2)
const noModels = args.includes('--no-models')
const clean = args.includes('--clean')
const help = args.includes('--help')

if (help) {
  console.log(`
Socket AI WASM Bundle Builder

Usage: node scripts/build.mjs [options]

Options:
  --no-models    Build without embedding models (fast, for testing)
  --clean        Clean build and dist directories before building
  --help         Show this help message

Examples:
  node scripts/build.mjs                # Full build with models
  node scripts/build.mjs --no-models    # Fast build for testing
  node scripts/build.mjs --clean        # Clean and rebuild
`)
  process.exit(0)
}

function exec(command, options = {}) {
  console.log(`$ ${command}`)
  return execSync(command, {
    cwd: PACKAGE_ROOT,
    stdio: 'inherit',
    ...options,
  })
}

async function cleanDirectories() {
  console.log('\nCleaning build directories...')

  const dirsToClean = [BUILD_DIR, DIST_DIR, TARGET_DIR]

  for (const dir of dirsToClean) {
    if (existsSync(dir)) {
      console.log(`  Removing ${path.basename(dir)}/`)
      await fs.rm(dir, { recursive: true, force: true })
    }
  }
}

async function createDirectories() {
  console.log('\nCreating directories...')

  for (const dir of [BUILD_DIR, DIST_DIR]) {
    if (!existsSync(dir)) {
      console.log(`  Creating ${path.basename(dir)}/`)
      mkdirSync(dir, { recursive: true })
    }
  }
}

async function buildWasm() {
  console.log('\nBuilding WASM bundle...')

  const features = []
  if (noModels) {
    features.push('no-models')
    console.log('  Mode: Fast build (no models embedded)')
  } else {
    console.log('  Mode: Full build (models embedded)')
  }

  const featuresFlag = features.length > 0 ? `--features ${features.join(',')}` : ''
  const cargoCommand = `cargo build --release --target wasm32-unknown-unknown ${featuresFlag}`.trim()

  exec(cargoCommand)

  // Copy built WASM to build directory.
  const wasmSource = path.join(
    TARGET_DIR,
    'wasm32-unknown-unknown',
    'release',
    'socket_ai.wasm'
  )
  const wasmBuild = path.join(BUILD_DIR, 'socket_ai.wasm')

  if (existsSync(wasmSource)) {
    await fs.copyFile(wasmSource, wasmBuild)
    const stats = await fs.stat(wasmBuild)
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(1)
    console.log(`  Built: ${sizeMB} MB → build/socket_ai.wasm`)
  } else {
    throw new Error(`Build failed: ${wasmSource} not found`)
  }

  return wasmBuild
}

async function optimizeWasm(inputPath) {
  console.log('\nOptimizing WASM...')

  // Check if wasm-opt is available.
  try {
    execSync('wasm-opt --version', { stdio: 'ignore' })
  } catch {
    console.log('  Warning: wasm-opt not found, skipping optimization')
    console.log('  Install: brew install binaryen')
    return inputPath
  }

  const optimizedPath = path.join(BUILD_DIR, 'socket_ai.optimized.wasm')

  exec(
    `wasm-opt -Oz --enable-simd --enable-bulk-memory ${inputPath} -o ${optimizedPath}`
  )

  const originalSize = (await fs.stat(inputPath)).size
  const optimizedSize = (await fs.stat(optimizedPath)).size
  const reduction = (((originalSize - optimizedSize) / originalSize) * 100).toFixed(1)

  console.log(
    `  Optimized: ${(optimizedSize / (1024 * 1024)).toFixed(1)} MB (${reduction}% reduction)`
  )

  return optimizedPath
}

async function copyToDist(sourcePath) {
  console.log('\nCopying to dist/...')

  const distPath = path.join(DIST_DIR, 'socket_ai.wasm')
  await fs.copyFile(sourcePath, distPath)

  const stats = await fs.stat(distPath)
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(1)
  console.log(`  Final: ${sizeMB} MB → dist/socket_ai.wasm`)

  return distPath
}

async function printSummary(finalPath) {
  console.log('\n' + '='.repeat(50))
  console.log('Build Summary')
  console.log('='.repeat(50))

  const stats = await fs.stat(finalPath)
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(1)

  console.log(`Mode:     ${noModels ? 'Fast (no models)' : 'Full (with models)'}`)
  console.log(`Output:   ${path.relative(PACKAGE_ROOT, finalPath)}`)
  console.log(`Size:     ${sizeMB} MB`)

  if (!noModels) {
    console.log('\nEmbedded models:')
    console.log('  - MiniLM INT4 (~17 MB)')
    console.log('  - CodeT5 Encoder INT4 (~34 MB)')
    console.log('  - CodeT5 Decoder INT4 (~56 MB)')
    console.log('  - ONNX Runtime SIMD (~3 MB)')
    console.log('  - Yoga Layout (~95 KB)')
  }

  console.log('\nBuild complete!')
}

async function main() {
  try {
    console.log('Socket AI WASM Bundle Builder')
    console.log('=' .repeat(50))

    if (clean) {
      await cleanDirectories()
    }

    await createDirectories()
    const builtWasm = await buildWasm()
    const optimizedWasm = await optimizeWasm(builtWasm)
    const finalWasm = await copyToDist(optimizedWasm)
    await printSummary(finalWasm)
  } catch (error) {
    console.error('\nBuild failed:', error.message)
    process.exit(1)
  }
}

main()
