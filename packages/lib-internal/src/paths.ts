/**
 * @fileoverview Path utilities for Socket ecosystem directories.
 * Provides platform-aware path resolution for Socket tools' shared directory structure.
 *
 * Directory Structure:
 * ~/.socket/
 * ├── _cacache/           # Content-addressable cache for npm packages
 * ├── _dlx/               # DLX installations (content-addressed by hash)
 * │   ├── <hash>/         # npm package installs (dlx-package)
 * │   └── <hash>/         # binary downloads (dlx-binary)
 * ├── _socket/            # Socket CLI app directory
 * ├── _registry/          # Socket Registry app directory
 * └── _sfw/               # Socket Firewall app directory
 */

import * as os from 'os'
import * as path from 'path'

import { getHome } from '#env/home'
import {
  getSocketCacacheDir as getSocketCacacheDirEnv,
  getSocketDlxDirEnv,
} from '#env/socket'
import { getUserprofile } from '#env/windows'

import { normalizePath } from './path'
import { getPathValue, registerCacheInvalidation } from './paths/rewire'

/**
 * Get the OS home directory.
 * Can be overridden in tests using setPath('homedir', ...) from paths/rewire.
 */
export function getOsHomeDir(): string {
  // Always check for overrides - don't cache when using rewire
  return getPathValue('homedir', () => os.homedir())
}

/**
 * Get the OS temporary directory.
 * Can be overridden in tests using setPath('tmpdir', ...) from paths/rewire.
 */
export function getOsTmpDir(): string {
  // Always check for overrides - don't cache when using rewire
  return getPathValue('tmpdir', () => os.tmpdir())
}

/**
 * Get the Socket home directory (~/.socket).
 * Alias for getSocketUserDir() for consistency across Socket projects.
 */
export function getSocketHomePath(): string {
  return getSocketUserDir()
}

let _cachedSocketUserDir: string | undefined

/**
 * Get the Socket user directory (~/.socket).
 * Result is memoized for performance.
 */
export function getSocketUserDir(): string {
  if (_cachedSocketUserDir === undefined) {
    _cachedSocketUserDir = normalizePath(
      path.join(
        getUserHomeDir(),
        /*@__INLINE__*/ require('#constants/paths').DOT_SOCKET_DIR,
      ),
    )
  }
  return _cachedSocketUserDir
}

/**
 * Get a Socket app directory (~/.socket/_<appName>).
 */
export function getSocketAppDir(appName: string): string {
  return normalizePath(
    path.join(
      getSocketUserDir(),
      `${/*@__INLINE__*/ require('#constants/socket').SOCKET_APP_PREFIX}${appName}`,
    ),
  )
}

let _cachedSocketCacacheDir: string | undefined

/**
 * Get the Socket cacache directory (~/.socket/_cacache).
 * Can be overridden with SOCKET_CACACHE_DIR environment variable for testing.
 * Result is memoized for performance.
 */
export function getSocketCacacheDir(): string {
  if (_cachedSocketCacacheDir === undefined) {
    if (getSocketCacacheDirEnv()) {
      _cachedSocketCacacheDir = normalizePath(
        getSocketCacacheDirEnv() as string,
      )
    } else {
      _cachedSocketCacacheDir = normalizePath(
        path.join(
          getSocketUserDir(),
          `${/*@__INLINE__*/ require('#constants/socket').SOCKET_APP_PREFIX}cacache`,
        ),
      )
    }
  }
  return _cachedSocketCacacheDir
}

/**
 * Get the Socket DLX directory (~/.socket/_dlx).
 * Can be overridden with SOCKET_DLX_DIR environment variable for testing.
 */
export function getSocketDlxDir(): string {
  if (getSocketDlxDirEnv()) {
    return normalizePath(getSocketDlxDirEnv() as string)
  }
  return normalizePath(
    path.join(
      getSocketUserDir(),
      `${/*@__INLINE__*/ require('#constants/socket').SOCKET_APP_PREFIX}${/*@__INLINE__*/ require('#constants/socket').SOCKET_DLX_APP_NAME}`,
    ),
  )
}

/**
 * Get a Socket app cache directory (~/.socket/_<appName>/cache).
 */
export function getSocketAppCacheDir(appName: string): string {
  return normalizePath(
    path.join(
      getSocketAppDir(appName),
      /*@__INLINE__*/ require('#constants/paths').CACHE_DIR,
    ),
  )
}

/**
 * Get a Socket app TTL cache directory (~/.socket/_<appName>/cache/ttl).
 */
export function getSocketAppCacheTtlDir(appName: string): string {
  return normalizePath(
    path.join(
      getSocketAppCacheDir(appName),
      /*@__INLINE__*/ require('#constants/paths').CACHE_TTL_DIR,
    ),
  )
}

/**
 * Get the Socket CLI directory (~/.socket/_socket).
 */
export function getSocketCliDir(): string {
  return getSocketAppDir(
    /*@__INLINE__*/ require('#constants/socket').SOCKET_CLI_APP_NAME,
  )
}

/**
 * Get the Socket Registry directory (~/.socket/_registry).
 */
export function getSocketRegistryDir(): string {
  return getSocketAppDir(
    /*@__INLINE__*/ require('#constants/socket').SOCKET_REGISTRY_APP_NAME,
  )
}

/**
 * Get the Socket Registry GitHub cache directory (~/.socket/_registry/cache/ttl/github).
 */
export function getSocketRegistryGithubCacheDir(): string {
  return normalizePath(
    path.join(
      getSocketAppCacheTtlDir(
        /*@__INLINE__*/ require('#constants/socket').SOCKET_REGISTRY_APP_NAME,
      ),
      /*@__INLINE__*/ require('#constants/github').CACHE_GITHUB_DIR,
    ),
  )
}

/**
 * Get the user's home directory.
 * Uses environment variables directly to support test mocking.
 * Falls back to os.homedir() if env vars not set.
 */
export function getUserHomeDir(): string {
  // Try HOME first (Unix)
  const home = getHome()
  if (home) {
    return home
  }
  // Try USERPROFILE (Windows)
  const userProfile = getUserprofile()
  if (userProfile) {
    return userProfile
  }
  // Fallback to os.homedir()
  return getOsHomeDir()
}

/**
 * Invalidate all cached path values.
 * Called automatically by the paths/rewire module when setPath/clearPath/resetPaths are used.
 *
 * @internal Used for test rewiring
 */
export function invalidateCache(): void {
  _cachedSocketUserDir = undefined
  _cachedSocketCacacheDir = undefined
}

// Register cache invalidation with the rewire module
registerCacheInvalidation(invalidateCache)
