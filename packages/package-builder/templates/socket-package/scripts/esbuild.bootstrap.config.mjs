/**
 * esbuild configuration for Socket npm wrapper bootstrap.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { deadCodeEliminationPlugin } from 'build-infra/lib/esbuild-plugin-dead-code-elimination'
import semver from 'semver'


const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, '..')
const monorepoRoot = path.resolve(packageRoot, '../..')
const bootstrapPackage = path.join(monorepoRoot, 'packages/bootstrap')

// Read Node.js version from config.
const nodeVersionPath = path.join(bootstrapPackage, 'node-version.json')
const nodeVersionConfig = JSON.parse(readFileSync(nodeVersionPath, 'utf8'))
const minNodeVersion = nodeVersionConfig.versionSemver

// Read Socket CLI version from package.json.
const packageJsonPath = path.join(packageRoot, 'package.json')
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
const cliVersion = packageJson.version
const cliVersionMajor = String(semver.major(cliVersion))

export default {
  banner: {
    js: '#!/usr/bin/env node',
  },
  bundle: true,
  define: {
    __MIN_NODE_VERSION__: JSON.stringify(minNodeVersion),
    __SOCKET_CLI_VERSION__: JSON.stringify(cliVersion),
    __SOCKET_CLI_VERSION_MAJOR__: JSON.stringify(cliVersionMajor),
    INLINED_SOCKET_BOOTSTRAP_PUBLISHED_BUILD: 'true',
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
  plugins: [],
  target: 'node18',
  treeShaking: true,
  write: false,
}
