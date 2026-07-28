/**
 * TEMP environment variable. Temporary directory path, Windows systems.
 */

import { getTemp } from '@socketsecurity/lib-stable/env/temp-dir'

// oxlint-disable-next-line socket/exported-name-has-domain-word -- the env/ module convention exports the literal environment variable name (TEMP is the Windows temp-dir var).
export const TEMP = getTemp()
