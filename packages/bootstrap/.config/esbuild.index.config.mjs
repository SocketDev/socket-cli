/**
 * esbuild configuration for Socket bootstrap index loader.
 * Builds the brotli decompression loader that loads compressed bootstraps.
 * Pattern follows packages/cli/.config/esbuild.index.config.mjs design.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.resolve(__dirname, '..')

const config = {
  bundle: true,
  entryPoints: [path.join(rootPath, 'src', 'index.mts')],
  external: [],
  format: 'cjs',
  minifyWhitespace: true,
  minifyIdentifiers: true,
  minifySyntax: false,
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
