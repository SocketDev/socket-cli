/**
 * @fileoverview Temporary directory environment variable getters.
 * Different platforms use different environment variables for temp directories.
 */

import { getEnvValue } from '#env/rewire'

/**
 * TMPDIR environment variable.
 * Unix/macOS temporary directory path.
 */
export function getTmpdir(): string | undefined {
  return getEnvValue('TMPDIR')
}

/**
 * TEMP environment variable.
 * Windows temporary directory path.
 */
export function getTemp(): string | undefined {
  return getEnvValue('TEMP')
}

/**
 * TMP environment variable.
 * Alternative temporary directory path.
 */
export function getTmp(): string | undefined {
  return getEnvValue('TMP')
}
