/**
 * @file Path constants for Socket CLI build scripts.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { packageNodeModulesBinPath } from '../paths.mts'

export * from '../paths.mts'

// Compute root path from this file's location.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const rootPath = path.resolve(__dirname, '../../../..')

// Base directory paths, no dist dependency.
export const configPath = path.join(rootPath, '.config')
export const externalPath = path.join(rootPath, 'external')
export const srcPath = path.join(rootPath, 'src')

// Package and lockfile paths.
export const rootNodeModulesBinPath = packageNodeModulesBinPath(rootPath)

// Repo-owned tool-cache segment at the repo root, outside node_modules.
export const REPO_CACHE_DIR = path.join(rootPath, '.cache', 'repo')
