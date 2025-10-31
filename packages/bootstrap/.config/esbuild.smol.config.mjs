/**
 * esbuild configuration for smol bootstrap.
 * Transforms node:* requires to internal/* for Node.js internal bootstrap context.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

import { unicodeTransformPlugin } from '@socketsecurity/build-infra/lib/esbuild-plugin-unicode-transform'

import nodeVersionConfig from '../node-version.json' with { type: 'json' }

import { smolTransformPlugin } from './esbuild-plugin-smol-transform.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.resolve(__dirname, '..')

const config = {
  bundle: true,
  define: {
    __MIN_NODE_VERSION__: JSON.stringify(nodeVersionConfig.versionSemver),
  },
  entryPoints: [path.join(rootPath, 'src', 'bootstrap-smol.mts')],
  external: [],
  format: 'cjs',
  metafile: true,
  minifyWhitespace: true,
  minifyIdentifiers: true,
  minifySyntax: false,
  outfile: path.join(rootPath, 'dist', 'bootstrap-smol.js'),
  platform: 'node',
  plugins: [unicodeTransformPlugin(), smolTransformPlugin()],
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
