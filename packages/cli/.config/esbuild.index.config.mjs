/**
 * esbuild configuration for Socket CLI index loader.
 * Builds the brotli decompression loader that executes the compressed CLI.
 */

import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.resolve(__dirname, '..')

const config = {
  banner: {
    js: '#!/usr/bin/env node',
  },
  bundle: true,
  entryPoints: [path.join(rootPath, 'src', 'index.mts')],
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
