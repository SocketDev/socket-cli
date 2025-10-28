/**
 * esbuild configuration for smol bootstrap.
 * Transforms node:* requires to internal/* for Node.js internal bootstrap context.
 */

import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { smolTransformPlugin } from './esbuild-plugin-smol-transform.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.resolve(__dirname, '..')

const config = {
  banner: {
    js: '#!/usr/bin/env node',
  },
  bundle: true,
  entryPoints: [path.join(rootPath, 'src', 'bootstrap-smol.mts')],
  external: [],
  format: 'cjs',
  metafile: true,
  minify: true,
  outfile: path.join(rootPath, 'dist', 'bootstrap-smol.js'),
  platform: 'node',
  plugins: [smolTransformPlugin()],
  target: 'node24',
  treeShaking: true,
  write: false, // Plugin needs to transform output.
}

// Run build if invoked directly.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  build(config).catch(error => {
    console.error('smol bootstrap build failed:', error)
    process.exitCode = 1
  })
}

export default config
