/**
 * esbuild configuration for Socket npm wrapper bootstrap.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
  entryPoints: [path.join(bootstrapPackage, 'src', 'bootstrap-npm.mts')],
  external: [],
  format: 'cjs',
  metafile: true,
  minifyWhitespace: true,
  minifyIdentifiers: true,
  minifySyntax: false,
  outfile: path.join(packageRoot, 'dist', 'bootstrap.js'),
  platform: 'node',
  target: 'node18',
  treeShaking: true,
}
