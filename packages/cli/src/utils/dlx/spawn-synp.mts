/**
 * Spawn synp for converting between yarn.lock and package-lock.json.
 *
 * - spawnSynpDlx: install via Socket dlx, then exec.
 * - spawnSynpVfs: extract from SEA bundle, then exec.
 * - spawnSynp: auto-detect SEA vs npm-CLI mode and dispatch.
 *
 * synp is a pure-npm package (no GitHub release / no local override), so the
 * Dlx flow is just `spawnDlx` with the synp version pin. Vfs and auto-dispatch
 * use the standard helpers from define-tool-spawn.
 */

import {
  defineAutoDispatch,
  defineVfsSpawn,
} from './define-tool-spawn.mts'
import { spawnDlx } from './spawn.mts'
import { getSynpVersion } from '../../env/synp-version.mts'

import type { DlxOptions, DlxSpawnResult } from './spawn.mts'
import type { SpawnExtra } from '@socketsecurity/lib/spawn'

/**
 * Helper to spawn synp with dlx.
 */
export async function spawnSynpDlx(
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

export const spawnSynpVfs = defineVfsSpawn('synp')

export const spawnSynp = defineAutoDispatch({
  vfs: spawnSynpVfs,
  dlx: spawnSynpDlx,
})
