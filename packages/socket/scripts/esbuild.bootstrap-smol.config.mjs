/**
 * esbuild configuration for Socket bootstrap (smol builds).
 *
 * Transforms node:* requires to internal/* requires for compatibility
 * with Node.js internal bootstrap context.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { smolTransformPlugin } from './esbuild-plugin-smol-transform.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, '..')
const monorepoRoot = path.resolve(packageRoot, '../..')
const bootstrapPackage = path.join(monorepoRoot, 'packages/bootstrap')

// Read Node.js version from config.
const nodeVersionPath = path.join(bootstrapPackage, 'node-version.json')
const nodeVersionConfig = JSON.parse(readFileSync(nodeVersionPath, 'utf8'))
const minNodeVersion = nodeVersionConfig.versionSemver

export default {
  banner: {
    js: '#!/usr/bin/env node',
  },
  bundle: true,
  define: {
    __MIN_NODE_VERSION__: JSON.stringify(minNodeVersion),
  },
  entryPoints: [path.join(bootstrapPackage, 'src', 'bootstrap-smol.mts')],
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
