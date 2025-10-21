/** @fileoverview Path constants for Socket CLI build scripts. */

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

// Directory name constant.
export const CONSTANTS = 'constants'
