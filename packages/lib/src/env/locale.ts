/**
 * @fileoverview Locale and language environment variable getters.
 * Provides access to system locale settings.
 */

import { getEnvValue } from '#env/rewire'

/**
 * LANG environment variable.
 * System locale and language settings.
 */
export function getLang(): string | undefined {
  return getEnvValue('LANG')
}

/**
 * LC_ALL environment variable.
 * Override for all locale settings.
 */
export function getLcAll(): string | undefined {
  return getEnvValue('LC_ALL')
}

/**
 * LC_MESSAGES environment variable.
 * Locale setting for message translations.
 */
export function getLcMessages(): string | undefined {
  return getEnvValue('LC_MESSAGES')
}
