/**
 * esbuild configuration for SEA (Single Executable Application) bootstrap.
 * Standard Node.js modules (node:* requires) for SEA entry point.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { unicodeTransformPlugin } from 'build-infra/lib/esbuild-plugin-unicode-transform'
import semver from 'semver'

import { createBuildRunner } from '../../cli/scripts/esbuild-shared.mjs'


import socketPackageJson from '../../cli/package.json' with { type: 'json' }

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.resolve(__dirname, '..')

const config = {
  banner: {
    js: '#!/usr/bin/env node',
  },
  bundle: true,
  define: {
    __SOCKET_CLI_VERSION__: JSON.stringify(socketPackageJson.version),
    __SOCKET_CLI_VERSION_MAJOR__: JSON.stringify(
      semver.major(socketPackageJson.version),
    ),
  },
  entryPoints: [path.join(rootPath, 'src', 'bootstrap-sea.mts')],
  external: [],
  format: 'cjs',
  metafile: true,
  minifyWhitespace: true,
  minifyIdentifiers: true,
  minifySyntax: false,
  outfile: path.join(rootPath, 'dist', 'bootstrap-sea.js'),
  platform: 'node',
  plugins: [unicodeTransformPlugin()],
  target: 'node18',
  treeShaking: true,
  // Plugin needs to transform output.
  write: false,
}

export default createBuildRunner(config, 'Bootstrap SEA')
