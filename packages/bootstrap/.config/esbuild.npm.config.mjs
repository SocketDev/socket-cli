/**
 * esbuild configuration for npm bootstrap.
 * Standard Node.js modules (node:* requires).
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

import { unicodeTransformPlugin } from '@socketsecurity/build-infra/lib/esbuild-plugin-unicode-transform'

import nodeVersionConfig from '../node-version.json' with { type: 'json' }

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.resolve(__dirname, '..')

const config = {
  banner: {
    js: '#!/usr/bin/env node',
  },
  bundle: true,
  define: {
    __MIN_NODE_VERSION__: JSON.stringify(nodeVersionConfig.versionSemver),
  },
  entryPoints: [path.join(rootPath, 'src', 'bootstrap-npm.mts')],
  external: [],
  format: 'cjs',
  metafile: true,
  minify: true,
  outfile: path.join(rootPath, 'dist', 'bootstrap-npm.js'),
  platform: 'node',
  plugins: [unicodeTransformPlugin()],
  target: 'node18',
  treeShaking: true,
  write: false, // Plugin needs to transform output.
}

// Run build if invoked directly.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  build(config).catch(error => {
    console.error('npm bootstrap build failed:', error)
    process.exitCode = 1
  })
}

export default config
