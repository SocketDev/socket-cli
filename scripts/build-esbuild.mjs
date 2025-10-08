#!/usr/bin/env node
/**
 * @fileoverview Alternative build script using esbuild for faster builds.
 * This is an experimental faster alternative to the rollup build.
 */

import { build } from 'esbuild'
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootPath = path.join(__dirname, '..')
const srcPath = path.join(rootPath, 'src')
const distPath = path.join(rootPath, 'dist')

// Clean and prepare dist directory
async function prepareDist() {
  if (existsSync(distPath)) {
    await rm(distPath, { recursive: true, force: true })
  }
  await mkdir(distPath, { recursive: true })
}

// Build with esbuild
async function buildWithEsbuild() {
  const entryPoints = [
    'cli.mts',
    'npm-cli.mts',
    'npx-cli.mts',
    'pnpm-cli.mts',
    'yarn-cli.mts',
    'constants.mts',
    'shadow/npm/bin.mts',
    'shadow/npm/inject.mts',
    'shadow/npx/bin.mts',
    'shadow/pnpm/bin.mts',
    'external/ink-table.mjs',
    'external/yoga-layout.mjs',
  ].map(file => path.join(srcPath, file))

  const result = await build({
    entryPoints,
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outdir: distPath,
    outExtension: { '.js': '.js' },
    splitting: false,
    minify: false,
    keepNames: true,
    external: [
      '@socketsecurity/registry',
      '@socketsecurity/sdk',
      'node:*',
    ],
    loader: {
      '.mts': 'ts',
      '.mjs': 'js',
      '.ts': 'ts',
      '.tsx': 'tsx',
    },
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    logLevel: 'info',
    metafile: true,
  })

  // Output build analysis
  const analysis = await build({
    ...result,
    metafile: true,
    write: false,
  })

  const text = await require('esbuild').analyzeMetafile(result.metafile, {
    verbose: false,
  })

  console.log('\n📊 Build Analysis:')
  console.log(text)
}

async function main() {
  const startTime = Date.now()

  try {
    console.log('🚀 Starting esbuild build...\n')

    await prepareDist()
    await buildWithEsbuild()

    const duration = ((Date.now() - startTime) / 1000).toFixed(2)
    console.log(`\n✅ Build completed in ${duration}s`)
  } catch (error) {
    console.error('❌ Build failed:', error)
    process.exit(1)
  }
}

main()