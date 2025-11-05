/**
 * PATH environment variable getter.
 * System executable search paths.
 */

import { getEnvValue } from '#env/rewire'

export function getPath(): string | undefined {
  return getEnvValue('PATH')
}
