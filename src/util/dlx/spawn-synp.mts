import { spawnDlx } from './spawn.mts'
import { getSynpVersion } from '../../env/synp-version.mts'

import type { DlxOptions, DlxSpawnResult } from './spawn.mts'
import type { SpawnExtra } from '@socketsecurity/lib-stable/process/spawn/types'

/**
 * Helper to spawn synp with dlx.
 */
export async function spawnSynp(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  return await spawnDlx(
    {
      name: 'synp',
      version: getSynpVersion(),
    },
    args,
    { force: false, ...options },
    spawnExtra,
  )
}
