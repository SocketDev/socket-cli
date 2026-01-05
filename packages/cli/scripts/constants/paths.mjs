/** @fileoverview Path constants for Socket CLI build scripts. */

import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  NODE_MODULES,
  PACKAGE_JSON,
  PNPM_LOCK_YAML,
  SOCKET_REGISTRY_PACKAGE_NAME,
} from './packages.mjs'

// Compute root path from this file's location.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const rootPath = path.resolve(__dirname, '../..')

// Base directory paths (no dist dependency).
export const configPath = path.join(rootPath, '.config')
export const externalPath = path.join(rootPath, 'external')
export const srcPath = path.join(rootPath, 'src')

// Package and lockfile paths.
export const rootPackageJsonPath = path.join(rootPath, PACKAGE_JSON)
export const rootPackageLockPath = path.join(rootPath, PNPM_LOCK_YAML)
export const rootNodeModulesBinPath = path.join(rootPath, NODE_MODULES, '.bin')

// Socket registry path (in external, not dist).
export const socketRegistryPath = path.join(
  externalPath,
  SOCKET_REGISTRY_PACKAGE_NAME,
)

// Cache directory paths.
export const SOCKET_CACHE_DIR = path.join(homedir(), '.socket')
export const SOCKET_CLI_SEA_BUILD_DIR = path.join(
  tmpdir(),
  'socket-cli-sea-build',
)
export const SOCKET_CLI_SEA_BUILD_DIR_FALLBACK = '/tmp/socket-cli-sea-build'

// Directory name constant.
export const CONSTANTS = 'constants'

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
