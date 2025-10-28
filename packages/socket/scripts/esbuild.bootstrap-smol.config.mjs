/**
 * esbuild configuration for Socket bootstrap (smol builds).
 *
 * Transforms node:* requires to internal/* requires for compatibility
 * with Node.js internal bootstrap context.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { smolTransformPlugin } from './esbuild-plugin-smol-transform.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, '..')

export default {
  banner: {
    js: '#!/usr/bin/env node',
  },
  bundle: true,
  entryPoints: [path.join(packageRoot, 'src', 'bootstrap.mts')],
  external: [],
  format: 'cjs',
  metafile: true,
  minify: true,
  outfile: path.join(packageRoot, 'dist', 'bootstrap-smol.js'),
  platform: 'node',
  plugins: [smolTransformPlugin()],
  target: 'node18',
  treeShaking: true,
  write: false, // Required for onEnd to modify outputs.
}
