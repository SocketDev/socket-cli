/**
 * PRE_COMMIT environment variable getter.
 * Whether running in a pre-commit hook context.
 */

import { envAsBoolean } from '#env/helpers'
import { getEnvValue } from '#env/rewire'

export function getPreCommit(): boolean {
  return envAsBoolean(getEnvValue('PRE_COMMIT'))
}
