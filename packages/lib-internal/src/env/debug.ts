/**
 * DEBUG environment variable getter.
 * Controls debug output for the debug package.
 */

import { getEnvValue } from '#env/rewire'

export function getDebug(): string | undefined {
  return getEnvValue('DEBUG')
}
