/**
 * esbuild configuration for npm bootstrap.
 * Standard Node.js modules (node:* requires).
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'
import semver from 'semver'

import { unicodeTransformPlugin } from '@socketsecurity/build-infra/lib/esbuild-plugin-unicode-transform'

import nodeVersionConfig from '../node-version.json' with { type: 'json' }
import socketPackageJson from '../../socket/package.json' with { type: 'json' }

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.resolve(__dirname, '..')

const config = {
  banner: {
    js: '#!/usr/bin/env node',
  },
  bundle: true,
  define: {
    __MIN_NODE_VERSION__: JSON.stringify(nodeVersionConfig.versionSemver),
    __SOCKET_CLI_VERSION__: JSON.stringify(socketPackageJson.version),
    __SOCKET_CLI_VERSION_MAJOR__: JSON.stringify(semver.major(socketPackageJson.version)),
  },
  entryPoints: [path.join(rootPath, 'src', 'bootstrap-npm.mts')],
  external: [],
  format: 'cjs',
  metafile: true,
  minifyWhitespace: true,
  minifyIdentifiers: true,
  minifySyntax: false,
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
