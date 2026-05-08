/**
 * Spawn cdxgen (CycloneDX SBOM generator).
 *
 * - spawnCdxgenDlx: local override > Socket dlx download.
 * - spawnCdxgenVfs: extract from SEA bundle, then exec.
 * - spawnCdxgen: auto-detect SEA vs npm-CLI mode and dispatch.
 *
 * The local-override path is bespoke (cdxgen is a JS file when local), so
 * Dlx stays hand-rolled here. Vfs + auto-dispatch use the shared helpers
 * from define-tool-spawn.
 */

import { detectExecutableType } from '@socketsecurity/lib/dlx/detect'
import { spawn } from '@socketsecurity/lib/spawn'

import {
  defineAutoDispatch,
  defineVfsSpawn,
} from './define-tool-spawn.mts'
import { spawnDlx } from './spawn.mts'
import { resolveCdxgen } from './resolve-binary.mjs'

import type { DlxOptions, DlxSpawnResult } from './spawn.mts'
import type { StdioOptions } from 'node:child_process'
import type { SpawnExtra } from '@socketsecurity/lib/spawn'

/**
 * Helper to spawn cdxgen with dlx.
 * If SOCKET_CLI_CDXGEN_LOCAL_PATH environment variable is set, uses the local
 * cdxgen binary at that path instead of downloading from npm.
 */
export async function spawnCdxgenDlx(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  const resolution = resolveCdxgen()

  // Use local cdxgen if available.
  if (resolution.type === 'local') {
    const detection = detectExecutableType(resolution.path)
    const { env: spawnEnv, ...dlxOptions } = {
      __proto__: null,
      ...options,
    } as DlxOptions

    const spawnArgs =
      detection.type === 'binary' ? args : [resolution.path, ...args]
    const spawnCommand = detection.type === 'binary' ? resolution.path : 'node'

    const spawnPromise = spawn(spawnCommand, spawnArgs, {
      ...dlxOptions,
      env: {
        ...process.env,
        ...spawnEnv,
      },
      stdio: (spawnExtra?.['stdio'] as StdioOptions | undefined) ?? 'inherit',
    })

    return {
      spawnPromise,
    }
  }

  // Use dlx version (resolveCdxgen only returns 'local' or 'dlx' types).
  if (resolution.type !== 'dlx') {
    throw new Error(
      `internal: resolveCdxgen returned resolution.type="${resolution.type}" (expected "dlx"); this is a resolver contract bug — re-run with --debug and report the output`,
    )
  }
  return await spawnDlx(
    resolution.details,
    args,
    { force: false, ...options },
    spawnExtra,
  )
}

export const spawnCdxgenVfs = defineVfsSpawn('cdxgen')

export const spawnCdxgen = defineAutoDispatch({
  vfs: spawnCdxgenVfs,
  dlx: spawnCdxgenDlx,
})
