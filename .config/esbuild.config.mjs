/** @fileoverview esbuild configuration for Socket CLI - faster builds and smaller bundles */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import { analyzeMetafile, build } from 'esbuild'

import constants from '../scripts/constants.mjs'

const {
  INLINED_SOCKET_CLI_HOMEPAGE,
  INLINED_SOCKET_CLI_VERSION,
  INLINED_SOCKET_CLI_VERSION_HASH,
  distPath,
  srcPath,
} = constants

// Entry points for the CLI
const entryPoints = [
  path.join(srcPath, 'cli.mts'),
  path.join(srcPath, 'npm-cli.mts'),
  path.join(srcPath, 'npx-cli.mts'),
  path.join(srcPath, 'pnpm-cli.mts'),
  path.join(srcPath, 'constants.mts'),
]

// External packages that should not be bundled
const external = [
  '@socketsecurity/registry',
  '@socketsecurity/sdk',
  // Keep React/Ink external for lazy loading
  'react',
  'react-dom',
  'ink',
  'ink-table',
  '@pppp606/ink-chart',
  'yoga-layout',
]

async function buildCli() {
  console.log('🚀 Building Socket CLI with esbuild...\n')

  try {
    // Main build
    const result = await build({
      entryPoints,
      bundle: true,
      platform: 'node',
      target: 'node18',
      format: 'esm',
      outdir: distPath,

      // Code splitting for dynamic imports
      splitting: true,
      chunkNames: 'chunks/[name]-[hash]',

      // External dependencies
      external,

      // Optimizations
      minify: process.env.NODE_ENV === 'production',
      treeShaking: true,

      // Source maps for debugging
      sourcemap: process.env.NODE_ENV !== 'production',

      // Define global constants
      define: {
        'process.env.INLINED_SOCKET_CLI_VERSION': JSON.stringify(INLINED_SOCKET_CLI_VERSION),
        'process.env.INLINED_SOCKET_CLI_VERSION_HASH': JSON.stringify(INLINED_SOCKET_CLI_VERSION_HASH),
        'process.env.INLINED_SOCKET_CLI_HOMEPAGE': JSON.stringify(INLINED_SOCKET_CLI_HOMEPAGE),
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
      },

      // Handle .mts extensions
      resolveExtensions: ['.mts', '.ts', '.mjs', '.js', '.json'],

      // Generate metafile for bundle analysis
      metafile: true,

      // Preserve legal comments
      legalComments: 'linked',

      // Loader for different file types
      loader: {
        '.mts': 'ts',
        '.ts': 'ts',
        '.json': 'json',
      },

      // Banner for CLI files
      banner: {
        js: '#!/usr/bin/env node\n',
      },
    })

    // Analyze bundle if requested
    if (process.env.ANALYZE) {
      const analysis = await analyzeMetafile(result.metafile, {
        verbose: false,
      })
      console.log('📊 Bundle Analysis:\n', analysis)
    }

    // Write metafile for further analysis
    await fs.writeFile(
      path.join(distPath, 'metafile.json'),
      JSON.stringify(result.metafile, null, 2)
    )

    console.log('✅ Build completed successfully!\n')

    // Report sizes
    const stats = await fs.stat(path.join(distPath, 'cli.js'))
    console.log(`Main CLI bundle size: ${(stats.size / 1024).toFixed(2)} KB`)

  } catch (error) {
    console.error('❌ Build failed:', error)
    throw error
  }
}

// Build React/Ink components separately
async function buildReactComponents() {
  console.log('📦 Building React/Ink components...\n')

  const reactEntryPoints = [
    path.join(srcPath, 'commands/analytics/AnalyticsApp.js'),
    path.join(srcPath, 'commands/audit-log/AuditLogApp.js'),
    path.join(srcPath, 'commands/threat-feed/ThreatFeedApp.js'),
  ].filter(async (file) => {
    try {
      await fs.access(file)
      return true
    } catch {
      return false
    }
  })

  if (reactEntryPoints.length === 0) {
    console.log('No React components to build.')
    return
  }

  await build({
    entryPoints: reactEntryPoints,
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'esm',
    outdir: path.join(distPath, 'components'),

    // Don't bundle React - it will be provided by the runtime
    external: ['react', 'react-dom', 'ink', 'ink-table'],

    minify: process.env.NODE_ENV === 'production',
    treeShaking: true,

    resolveExtensions: ['.jsx', '.js', '.tsx', '.ts'],
  })

  console.log('✅ React components built successfully!\n')
}

// Run builds
async function main() {
  // Clean dist directory
  await fs.rm(distPath, { recursive: true, force: true })
  await fs.mkdir(distPath, { recursive: true })
  await fs.mkdir(path.join(distPath, 'chunks'), { recursive: true })
  await fs.mkdir(path.join(distPath, 'components'), { recursive: true })

  // Run builds in parallel
  await Promise.all([
    buildCli(),
    buildReactComponents(),
  ])
}

main().catch(console.error)