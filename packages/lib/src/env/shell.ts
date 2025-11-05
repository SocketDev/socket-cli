/**
 * SHELL environment variable getter.
 * Unix/macOS default shell path.
 */

import { getEnvValue } from '#env/rewire'

export function getShell(): string | undefined {
  return getEnvValue('SHELL')
}
