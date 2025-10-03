/**
 * Path utilities for Socket CLI directories.
 * Provides platform-aware path resolution for Socket CLI's directory structure.
 *
 * Directory Structure:
 * ~/.socket/_socket/
 * ├── cache/ttl/
 * │   ├── github/          # GitHub API cache
 * │   └── socket-api/      # Socket API cache
 * ├── cli/                 # CLI-specific files
 * ├── sea/                 # Single Executable Application build artifacts
 * ├── tmp/                 # Temporary files
 * └── updater/             # CLI updater files
 *     ├── backups/         # Backup files
 *     ├── downloads/       # Downloaded updates
 *     ├── staging/         # Staged updates
 *     └── state.json       # Updater state
 */

import path from 'node:path'

import {
  getSocketAppCacheDir,
  getSocketAppCacheTtlDir,
  getSocketCliDir,
} from '@socketsecurity/registry/lib/paths'

import constants from '../constants.mts'

/**
 * Get the Socket CLI base directory (~/.socket/_socket).
 */
export function getSocketCliBaseDir(): string {
  return getSocketCliDir()
}

/**
 * Get the Socket CLI cache directory (~/.socket/_socket/cache).
 */
export function getSocketCliCacheDir(): string {
  return getSocketAppCacheDir(constants.SOCKET_CLI_APP_NAME)
}

/**
 * Get the Socket CLI TTL cache directory (~/.socket/_socket/cache/ttl).
 */
export function getSocketCliCacheTtlDir(): string {
  return getSocketAppCacheTtlDir(constants.SOCKET_CLI_APP_NAME)
}

/**
 * Get the Socket CLI GitHub cache directory (~/.socket/_socket/cache/ttl/github).
 */
export function getSocketCliGithubCacheDir(): string {
  return path.join(getSocketCliCacheTtlDir(), constants.CACHE_GITHUB_DIR)
}

/**
 * Get the Socket CLI Socket API cache directory (~/.socket/_socket/cache/ttl/socket-api).
 */
export function getSocketCliSocketApiCacheDir(): string {
  return path.join(getSocketCliCacheTtlDir(), constants.CACHE_SOCKET_API_DIR)
}

/**
 * Get the Socket CLI directory (~/.socket/_socket/cli).
 */
export function getSocketCliCliDir(): string {
  return path.join(getSocketCliBaseDir(), constants.CLI_DIR)
}

/**
 * Get the Socket CLI SEA directory (~/.socket/_socket/sea).
 */
export function getSocketCliSeaDir(): string {
  return path.join(getSocketCliBaseDir(), constants.SEA_DIR)
}

/**
 * Get the Socket CLI temporary directory (~/.socket/_socket/tmp).
 */
export function getSocketCliTmpDir(): string {
  return path.join(getSocketCliBaseDir(), constants.TMP_DIR)
}

/**
 * Get the Socket CLI updater directory (~/.socket/_socket/updater).
 */
export function getSocketCliUpdaterDir(): string {
  return path.join(getSocketCliBaseDir(), constants.UPDATER_DIR)
}

/**
 * Get the Socket CLI updater downloads directory (~/.socket/_socket/updater/downloads).
 */
export function getSocketCliUpdaterDownloadsDir(): string {
  return path.join(getSocketCliUpdaterDir(), constants.UPDATER_DOWNLOADS_DIR)
}

/**
 * Get the Socket CLI updater backups directory (~/.socket/_socket/updater/backups).
 */
export function getSocketCliUpdaterBackupsDir(): string {
  return path.join(getSocketCliUpdaterDir(), constants.UPDATER_BACKUPS_DIR)
}

/**
 * Get the Socket CLI updater staging directory (~/.socket/_socket/updater/staging).
 */
export function getSocketCliUpdaterStagingDir(): string {
  return path.join(getSocketCliUpdaterDir(), constants.UPDATER_STAGING_DIR)
}

/**
 * Get the Socket CLI updater state file path (~/.socket/_socket/updater/state.json).
 */
export function getSocketCliUpdaterStateJsonPath(): string {
  return path.join(getSocketCliUpdaterDir(), constants.UPDATER_STATE_JSON)
}
