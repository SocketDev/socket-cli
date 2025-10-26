#!/usr/bin/env node
/**
 * Build separate WASM model packages for npm distribution.
 *
 * Builds individual WASM binaries for each model:
 * - minilm.wasm (~17 MB) - MiniLM embeddings only
 * - codet5.wasm (~90 MB) - CodeT5 code analysis only
 *
 * Usage:
 *   node scripts/wasm/build-model-packages.mjs [options]
 *
 * Options:
 *   --clean        Clean build directories before building
 *   --no-optimize  Skip wasm-opt optimization
 *   --help         Show this help message
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { logger } from '@socketsecurity/lib/logger'
import colors from 'yoctocolors-cjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '../..')
const wasmBundlePath = path.join(rootPath, 'packages/node-smol-builder/wasm-bundle')
const packagesPath = path.join(rootPath, 'packages')

// Parse command line arguments.
const args = process.argv.slice(2)
const clean = args.includes('--clean')
const noOptimize = args.includes('--no-optimize')
const help = args.includes('--help')

if (help) {
  logger.log(`
Build WASM Model Packages

Usage: node scripts/wasm/build-model-packages.mjs [options]

Options:
  --clean        Clean build directories before building
  --no-optimize  Skip wasm-opt optimization
  --help         Show this help message

Examples:
  node scripts/wasm/build-model-packages.mjs           # Build both packages
  node scripts/wasm/build-model-packages.mjs --clean   # Clean and rebuild
`)
  process.exit(0)
}

function exec(command, options = {}) {
  logger.log(`$ ${command}`)
  return execSync(command, {
    cwd: options.cwd || wasmBundlePath,
    stdio: 'inherit',
    ...options,
  })
}

async function getFileSizeMB(filePath) {
  const stats = await fs.stat(filePath)
  return (stats.size / 1024 / 1024).toFixed(1)
}

async function cleanBuild() {
  logger.log('\n🧹 Cleaning build directories...')
  const dirsToClean = [
    path.join(wasmBundlePath, 'build'),
    path.join(wasmBundlePath, 'target'),
  ]

  for (const dir of dirsToClean) {
    if (existsSync(dir)) {
      logger.log(`  Removing ${path.basename(dir)}/`)
      await fs.rm(dir, { recursive: true, force: true })
    }
  }
}

async function buildWasm(modelName, feature) {
  logger.log(`\n📦 Building ${modelName}...`)
  logger.log(`  Feature: ${feature}`)

  const buildDir = path.join(wasmBundlePath, 'build')
  mkdirSync(buildDir, { recursive: true })

  // Build with cargo.
  const cargoCommand = `cargo build --release --target wasm32-unknown-unknown --features ${feature}`
  exec(cargoCommand)

  // Copy built WASM.
  const wasmSource = path.join(
    wasmBundlePath,
    'target/wasm32-unknown-unknown/release/socket_ai.wasm'
  )
  const wasmBuild = path.join(buildDir, `${modelName}.wasm`)

  await fs.copyFile(wasmSource, wasmBuild)
  const sizeMB = await getFileSizeMB(wasmBuild)
  logger.log(`  Built: ${sizeMB} MB → build/${modelName}.wasm`)

  return wasmBuild
}

async function optimizeWasm(inputPath, modelName) {
  if (noOptimize) {
    logger.log('  Skipping optimization (--no-optimize)')
    return inputPath
  }

  logger.log('  Optimizing with wasm-opt...')

  // Check if wasm-opt is available.
  try {
    execSync('wasm-opt --version', { stdio: 'ignore' })
  } catch {
    logger.log('  Warning: wasm-opt not found, skipping optimization')
    logger.log('  Install: brew install binaryen')
    return inputPath
  }

  const buildDir = path.join(wasmBundlePath, 'build')
  const optimizedPath = path.join(buildDir, `${modelName}.optimized.wasm`)

  exec(
    `wasm-opt -Oz --enable-simd --enable-bulk-memory ${inputPath} -o ${optimizedPath}`
  )

  const originalSize = (await fs.stat(inputPath)).size
  const optimizedSize = (await fs.stat(optimizedPath)).size
  const reduction = (((originalSize - optimizedSize) / originalSize) * 100).toFixed(1)

  logger.log(`  Optimized: ${(optimizedSize / (1024 * 1024)).toFixed(1)} MB (${reduction}% reduction)`)

  return optimizedPath
}

async function copyToPackage(wasmPath, packageName, binaryName) {
  logger.log(`\n📦 Copying to ${packageName}...`)

  const packageDir = path.join(packagesPath, packageName)
  const binDir = path.join(packageDir, 'bin')

  // Create bin directory.
  mkdirSync(binDir, { recursive: true })

  // Copy WASM binary.
  const destPath = path.join(binDir, binaryName)
  await fs.copyFile(wasmPath, destPath)

  const sizeMB = await getFileSizeMB(destPath)
  logger.log(`  ✓ ${sizeMB} MB → packages/${packageName}/bin/${binaryName}`)
}

async function main() {
  try {
    logger.log('🚀 Building WASM Model Packages')
    logger.log('='.repeat(50))

    if (clean) {
      await cleanBuild()
    }

    // Build MiniLM package.
    const minilmWasm = await buildWasm('minilm', 'minilm-only')
    const minilmOptimized = await optimizeWasm(minilmWasm, 'minilm')
    await copyToPackage(minilmOptimized, 'socketbin-minilm-wasm', 'minilm.wasm')

    // Build CodeT5 package.
    const codet5Wasm = await buildWasm('codet5', 'codet5-only')
    const codet5Optimized = await optimizeWasm(codet5Wasm, 'codet5')
    await copyToPackage(codet5Optimized, 'socketbin-codet5-wasm', 'codet5.wasm')

    logger.log(`\n${colors.green('✓')} Build complete!`)
    logger.log('\nPackages ready:')
    logger.log('  - packages/socketbin-minilm-wasm/')
    logger.log('  - packages/socketbin-codet5-wasm/')
    logger.log('\nNext steps:')
    logger.log('  1. Test locally: cd packages/socketbin-minilm-wasm && npm pack')
    logger.log('  2. Publish: npm publish')
  } catch (error) {
    logger.error(`\n${colors.red('✗')} Build failed:`, error.message)
    process.exit(1)
  }
}

main()
