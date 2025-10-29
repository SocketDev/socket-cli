/**
 * esbuild configuration for Socket npm wrapper bootstrap.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, '..')
const monorepoRoot = path.resolve(packageRoot, '../..')
const bootstrapPackage = path.join(monorepoRoot, 'packages/bootstrap')

export default {
  banner: {
    js: '#!/usr/bin/env node',
  },
  bundle: true,
  entryPoints: [path.join(bootstrapPackage, 'src', 'bootstrap-npm.mts')],
  external: [],
  format: 'cjs',
  metafile: true,
  minify: true,
  outfile: path.join(packageRoot, 'dist', 'bootstrap.js'),
  platform: 'node',
  target: 'node18',
  treeShaking: true,
}
