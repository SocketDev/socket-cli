/**
 * esbuild configuration for Socket CLI with Sentry index loader.
 * Builds the brotli decompression loader that executes the compressed CLI.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.resolve(__dirname, '..')
const cliPath = path.resolve(__dirname, '../../cli')

const config = {
  banner: {
    js: '#!/usr/bin/env node',
  },
  bundle: true,
  entryPoints: [path.join(cliPath, 'src', 'index.mts')],
  external: [],
  format: 'cjs',
  minify: true,
  outfile: path.join(rootPath, 'dist', 'index.js'),
  platform: 'node',
  target: 'node18',
  treeShaking: true,
}

// Run build if invoked directly.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  build(config).catch(error => {
    console.error('Index loader build failed:', error)
    process.exitCode = 1
  })
}

export default config
