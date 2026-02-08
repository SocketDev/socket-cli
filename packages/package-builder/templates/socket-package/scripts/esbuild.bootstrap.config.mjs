/**
 * esbuild configuration for Socket npm wrapper bootstrap.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { deadCodeEliminationPlugin } from 'build-infra/lib/esbuild-plugin-dead-code-elimination'
import semver from 'semver'

/**
 * Find monorepo root by searching upward for .node-version file.
 */
function findMonorepoRoot(startDir) {
  let currentDir = startDir
  const rootDir = path.parse(currentDir).root
  while (currentDir !== rootDir) {
    if (existsSync(path.join(currentDir, '.node-version'))) {
      return currentDir
    }
    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) {
      break
    }
    currentDir = parentDir
  }
  throw new Error(
    `Could not find monorepo root (searched upward from ${startDir} for .node-version)`,
  )
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, '..')
const monorepoRoot = findMonorepoRoot(packageRoot)
const bootstrapPackage = path.join(monorepoRoot, 'packages/bootstrap')

// Read Node.js version from .node-version file.
const nodeVersionPath = path.join(monorepoRoot, '.node-version')
const minNodeVersion = readFileSync(nodeVersionPath, 'utf8').trim()
if (!minNodeVersion || !/^\d+\.\d+\.\d+$/.test(minNodeVersion)) {
  throw new Error(
    `Invalid Node version in .node-version: "${minNodeVersion}" (expected semver format)`,
  )
}

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
