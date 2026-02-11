/**
 * esbuild configuration for Socket bootstrap index loader.
 * Builds the brotli decompression loader that loads compressed bootstraps.
 * Pattern follows packages/cli/.config/esbuild.index.config.mjs design.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createBuildRunner } from '../../cli/scripts/esbuild-shared.mjs'

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

export default createBuildRunner(config, 'Bootstrap index loader')
