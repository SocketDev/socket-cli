/**
 * @fileoverview NPM environment variable getters.
 * Provides access to NPM and package manager environment variables.
 */

import { getEnvValue } from '#env/rewire'

/**
 * npm_config_registry environment variable.
 * NPM registry URL configured by package managers.
 */
export function getNpmConfigRegistry(): string | undefined {
  return getEnvValue('npm_config_registry')
}

/**
 * npm_config_user_agent environment variable.
 * User agent string set by npm/pnpm/yarn package managers.
 */
export function getNpmConfigUserAgent(): string | undefined {
  return getEnvValue('npm_config_user_agent')
}

/**
 * npm_lifecycle_event environment variable.
 * The name of the npm lifecycle event that's currently running.
 */
export function getNpmLifecycleEvent(): string | undefined {
  return getEnvValue('npm_lifecycle_event')
}

/**
 * NPM_REGISTRY environment variable.
 * NPM registry URL override.
 */
export function getNpmRegistry(): string | undefined {
  return getEnvValue('NPM_REGISTRY')
}

/**
 * NPM_TOKEN environment variable.
 * Authentication token for NPM registry access.
 */
export function getNpmToken(): string | undefined {
  return getEnvValue('NPM_TOKEN')
}
