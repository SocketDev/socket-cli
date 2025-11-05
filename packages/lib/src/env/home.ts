/**
 * HOME environment variable getter.
 * Points to the user's home directory.
 */

import { getEnvValue } from '#env/rewire'

export function getHome(): string | undefined {
  return getEnvValue('HOME')
}
