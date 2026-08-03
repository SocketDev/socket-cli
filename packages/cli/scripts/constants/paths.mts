/**
 * @file Path constants for Socket CLI build scripts.
 */

import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { NODE_MODULES } from './packages.mts'

// Compute root path from this file's location.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const rootPath = path.resolve(__dirname, '../..')

// Base directory paths, no dist dependency.
export const configPath = path.join(rootPath, '.config')
export const externalPath = path.join(rootPath, 'external')
export const srcPath = path.join(rootPath, 'src')

// Package and lockfile paths.
export const rootNodeModulesBinPath = path.join(rootPath, NODE_MODULES, '.bin')

// Cache directory paths.
// Repo-owned tool-cache segment at the repo root, NOT inside node_modules:
// the store has to outlive `rm -rf node_modules` and package `clean` sweeps.
export const REPO_CACHE_DIR = path.join(
  path.resolve(rootPath, '../..'),
  '.cache',
  'repo',
)
const SOCKET_CACHE_DIR = path.join(os.homedir(), '.socket')
export const SOCKET_CLI_SEA_BUILD_DIR = path.join(
  os.tmpdir(),
  'socket-cli-sea-build',
)
const SOCKET_CLI_SEA_BUILD_DIR_FALLBACK = '/tmp/socket-cli-sea-build'

/**
 * Get all global cache directories.
 */
export function getGlobalCacheDirs() {
  return [
    { name: '~/.socket', path: SOCKET_CACHE_DIR },
    { name: '$TMPDIR/socket-cli-sea-build', path: SOCKET_CLI_SEA_BUILD_DIR },
    {
      name: '/tmp/socket-cli-sea-build',
      path: SOCKET_CLI_SEA_BUILD_DIR_FALLBACK,
    },
  ]
}
