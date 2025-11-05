/**
 * @fileoverview Test environment variable getters and detection.
 * Provides access to test framework environment variables and utilities.
 */

import { envAsBoolean, envAsString } from '#env/helpers'
import { getNodeEnv } from '#env/node-env'
import { getEnvValue } from '#env/rewire'

/**
 * JEST_WORKER_ID environment variable.
 * Set when running tests with Jest.
 */
export function getJestWorkerId(): string {
  return envAsString(getEnvValue('JEST_WORKER_ID'))
}

/**
 * VITEST environment variable.
 * Set when running tests with Vitest.
 */
export function getVitest(): boolean {
  return envAsBoolean(getEnvValue('VITEST'))
}

/**
 * Check if code is running in a test environment.
 * Checks NODE_ENV, VITEST, and JEST_WORKER_ID.
 */
export function isTest(): boolean {
  const nodeEnv = envAsString(getNodeEnv())
  return nodeEnv === 'test' || getVitest() || !!getJestWorkerId()
}
