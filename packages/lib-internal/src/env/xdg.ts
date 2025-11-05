/**
 * @fileoverview XDG Base Directory Specification environment variable getters.
 * Provides access to XDG user directories on Unix systems.
 */

import { getEnvValue } from '#env/rewire'

/**
 * XDG_CACHE_HOME environment variable.
 * XDG Base Directory specification cache directory.
 */
export function getXdgCacheHome(): string | undefined {
  return getEnvValue('XDG_CACHE_HOME')
}

/**
 * XDG_CONFIG_HOME environment variable.
 * XDG Base Directory specification config directory.
 */
export function getXdgConfigHome(): string | undefined {
  return getEnvValue('XDG_CONFIG_HOME')
}

/**
 * XDG_DATA_HOME environment variable.
 * Points to the user's data directory on Unix systems.
 */
export function getXdgDataHome(): string | undefined {
  return getEnvValue('XDG_DATA_HOME')
}
