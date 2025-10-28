/**
 * esbuild configuration for npm bootstrap.
 * Standard Node.js modules (node:* requires).
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
  entryPoints: [path.join(rootPath, 'src', 'bootstrap-npm.mts')],
  external: [],
  format: 'cjs',
  metafile: true,
  minify: true,
  outfile: path.join(rootPath, 'dist', 'bootstrap-npm.js'),
  platform: 'node',
  target: 'node18',
  treeShaking: true,
}

// Run build if invoked directly.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  build(config).catch(error => {
    console.error('npm bootstrap build failed:', error)
    process.exitCode = 1
  })
}

export default config
