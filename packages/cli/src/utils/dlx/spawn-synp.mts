/**
 * Spawn synp for converting between yarn.lock and package-lock.json.
 *
 * - spawnSynpDlx: install via Socket dlx, then exec.
 * - spawnSynpVfs: extract from SEA bundle, then exec.
 * - spawnSynp: auto-detect SEA vs npm-CLI mode and dispatch.
 */

import { spawnDlx, spawnToolVfs } from './spawn.mts'
import { areExternalToolsAvailable } from './vfs-extract.mjs'
import { getSynpVersion } from '../../env/synp-version.mts'
import { isSeaBinary } from '../sea/detect.mts'

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

/**
 * Helper to spawn synp from VFS.
 * Used when running in SEA mode.
 */
export async function spawnSynpVfs(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  return await spawnToolVfs('synp', args, options, spawnExtra)
}

/**
 * Spawn synp (package.json converter).
 * Auto-detects SEA mode and uses appropriate spawn method.
 */
export async function spawnSynp(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  if (isSeaBinary() && areExternalToolsAvailable()) {
    return await spawnSynpVfs(args, options, spawnExtra)
  }
  return await spawnSynpDlx(args, options, spawnExtra)
}
