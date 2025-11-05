/**
 * TERM environment variable getter.
 * Terminal type identifier.
 */

import { getEnvValue } from '#env/rewire'

export function getTerm(): string | undefined {
  return getEnvValue('TERM')
}
