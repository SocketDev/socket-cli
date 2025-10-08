#!/usr/bin/env node
/**
 * @fileoverview Fixed esbuild script that properly handles React externalization
 * This version addresses top-level await and import.meta issues
 */

import { build } from 'esbuild'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootPath = path.join(__dirname, '..')
const srcPath = path.join(rootPath, 'src')
const distPath = path.join(rootPath, 'dist')

const startTime = performance.now()

// Clean and prepare dist directory
async function prepareDist() {
  if (existsSync(distPath)) {
    await rm(distPath, { recursive: true, force: true })
  }
  await mkdir(distPath, { recursive: true })
  await mkdir(path.join(distPath, 'shadow'), { recursive: true })
  await mkdir(path.join(distPath, 'external'), { recursive: true })
}

// Build main CLI files
async function buildMainCli() {
  console.log('📦 Building main CLI files...\n')

  // Build each entry point separately to avoid cross-dependencies
  const mainEntries = [
    { in: 'cli.mts', out: 'cli' },
    { in: 'npm-cli.mts', out: 'npm-cli' },
    { in: 'npx-cli.mts', out: 'npx-cli' },
    { in: 'pnpm-cli.mts', out: 'pnpm-cli' },
    { in: 'yarn-cli.mts', out: 'yarn-cli' },
    { in: 'constants.mts', out: 'constants' },
  ]

  for (const entry of mainEntries) {
    await build({
      entryPoints: [path.join(srcPath, entry.in)],
      bundle: true,
      platform: 'node',
      target: 'node18',
      format: 'cjs',
      outfile: path.join(distPath, `${entry.out}.js`),
      minify: process.env.NODE_ENV === 'production',
      keepNames: true,

      // External packages - keep React/Ink external
      external: [
        '@socketsecurity/registry',
        '@socketsecurity/sdk',
        'react',
        'react-dom',
        'ink',
        'ink-*',
        '@pppp606/ink-chart',
        'yoga-layout',
        'yoga-wasm-web',
        'react-devtools-core',
        '../dist/shadow-*',  // Shadow bins will be built separately
      ],

      // Replace import.meta.url with a Node-compatible alternative
      define: {
        'import.meta.url': `'file://' + __filename`,
        'process.env.NODE_ENV': '"production"',
      },

      // Inject helper for import.meta compatibility
      inject: [path.join(__dirname, 'esbuild-inject-helper.mjs')],

      loader: {
        '.mts': 'ts',
        '.mjs': 'js',
        '.ts': 'ts',
      },

      logLevel: 'warning',
    })

    console.log(`  ✅ Built ${entry.out}.js`)
  }
}

// Build shadow binaries
async function buildShadowBins() {
  console.log('\n📦 Building shadow binaries...\n')

  const shadowEntries = [
    { in: 'shadow/npm/bin.mts', out: 'shadow-npm-bin' },
    { in: 'shadow/npm/inject.mts', out: 'shadow-npm-inject' },
    { in: 'shadow/npx/bin.mts', out: 'shadow-npx-bin' },
    { in: 'shadow/pnpm/bin.mts', out: 'shadow-pnpm-bin' },
  ]

  for (const entry of shadowEntries) {
    const inputPath = path.join(srcPath, entry.in)

    // Check if file exists
    if (!existsSync(inputPath)) {
      console.log(`  ⚠️  Skipping ${entry.out} (file not found)`)
      continue
    }

    await build({
      entryPoints: [inputPath],
      bundle: true,
      platform: 'node',
      target: 'node18',
      format: 'cjs',
      outfile: path.join(distPath, `${entry.out}.js`),
      minify: process.env.NODE_ENV === 'production',
      keepNames: true,

      external: [
        '@socketsecurity/registry',
        '@socketsecurity/sdk',
        'react',
        'react-dom',
        'ink',
        'ink-*',
      ],

      define: {
        'import.meta.url': `'file://' + __filename`,
        'process.env.NODE_ENV': '"production"',
      },

      loader: {
        '.mts': 'ts',
        '.mjs': 'js',
        '.ts': 'ts',
      },

      logLevel: 'warning',
    })

    console.log(`  ✅ Built ${entry.out}.js`)
  }
}

// Build external modules
async function buildExternals() {
  console.log('\n📦 Building external modules...\n')

  const externalEntries = [
    { in: 'external/ink-table.mjs', out: 'external/ink-table' },
    { in: 'external/yoga-layout.mjs', out: 'external/yoga-layout' },
  ]

  for (const entry of externalEntries) {
    const inputPath = path.join(srcPath, entry.in)

    if (!existsSync(inputPath)) {
      console.log(`  ⚠️  Skipping ${entry.out} (file not found)`)
      continue
    }

    await build({
      entryPoints: [inputPath],
      bundle: false,  // Don't bundle externals
      platform: 'node',
      target: 'node18',
      format: 'cjs',
      outfile: path.join(distPath, `${entry.out}.js`),

      loader: {
        '.mjs': 'js',
      },

      logLevel: 'warning',
    })

    console.log(`  ✅ Built ${entry.out}.js`)
  }
}

// Create inject helper for import.meta compatibility
async function createInjectHelper() {
  const helperContent = `
// esbuild inject helper for import.meta compatibility
if (typeof __filename === 'undefined') {
  global.__filename = require('url').fileURLToPath(import.meta.url);
}
if (typeof __dirname === 'undefined') {
  global.__dirname = require('path').dirname(__filename);
}
`

  await writeFile(
    path.join(__dirname, 'esbuild-inject-helper.mjs'),
    helperContent,
    'utf8'
  )
}

// Report bundle sizes
async function reportSizes() {
  console.log('\n📏 Bundle Sizes:\n')

  const fs = await import('node:fs/promises')
  const files = await fs.readdir(distPath)

  let totalSize = 0
  const sizes = []

  for (const file of files) {
    if (file.endsWith('.js')) {
      const stats = await fs.stat(path.join(distPath, file))
      const sizeKB = (stats.size / 1024).toFixed(2)
      totalSize += stats.size
      sizes.push({ file, sizeKB, size: stats.size })
    }
  }

  // Sort by size
  sizes.sort((a, b) => b.size - a.size)

  for (const { file, sizeKB } of sizes) {
    console.log(`  ${file.padEnd(25)} ${sizeKB.padStart(10)} KB`)
  }

  console.log('  ' + '─'.repeat(37))
  console.log(`  ${'Total'.padEnd(25)} ${(totalSize / 1024).toFixed(2).padStart(10)} KB`)

  // Compare with rollup build if available
  try {
    const rollupStats = await fs.stat(path.join(rootPath, 'dist.rollup-backup/cli.js'))
    const rollupSizeKB = (rollupStats.size / 1024).toFixed(2)
    const reduction = ((1 - sizes.find(s => s.file === 'cli.js').size / rollupStats.size) * 100).toFixed(1)

    console.log('\n  📊 Comparison:')
    console.log(`  Rollup cli.js:  ${rollupSizeKB} KB`)
    console.log(`  esbuild cli.js: ${sizes.find(s => s.file === 'cli.js').sizeKB} KB`)
    console.log(`  Size reduction: ${reduction}% 🎉`)
  } catch {
    // No rollup build available for comparison
  }
}

async function main() {
  try {
    console.log('⚡ Socket CLI esbuild Builder\n')
    console.log('═'.repeat(50))

    await createInjectHelper()
    await prepareDist()

    // Build in parallel where possible
    await Promise.all([
      buildMainCli(),
      buildShadowBins(),
      buildExternals(),
    ])

    await reportSizes()

    const duration = ((performance.now() - startTime) / 1000).toFixed(2)
    console.log('\n═'.repeat(50))
    console.log(`✅ Build completed in ${duration}s`)
    console.log('═'.repeat(50))

  } catch (error) {
    console.error('❌ Build failed:', error)
    process.exit(1)
  }
}

main()