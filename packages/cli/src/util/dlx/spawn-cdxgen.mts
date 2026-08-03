/**
 * Spawn cdxgen (CycloneDX SBOM generator).
 *
 * - SpawnCdxgenDlx: local override > Socket dlx download.
 * - SpawnCdxgenVfs: extract from SEA bundle, then exec.
 * - SpawnCdxgen: auto-detect SEA vs npm-CLI mode and dispatch.
 *
 * The local-override path is bespoke (cdxgen is a JS file when local), so Dlx
 * stays hand-rolled here. Vfs + auto-dispatch use the shared helpers from
 * define-tool-spawn.
 */

import { detectExecutableType } from '@socketsecurity/lib-stable/dlx/detect'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { defineAutoDispatch, defineVfsSpawn } from './define-tool-spawn.mts'
import { spawnDlx } from './spawn.mts'
import { resolveCdxgen } from './resolve-binary.mjs'
import { buildSystemToolEnv } from '../spawn/system-tool.mts'
import { resolveNodeExecutable } from '../spawn/spawn-node.mts'

import type { DlxOptions, DlxSpawnResult } from './spawn.mts'
import type { StdioOptions } from 'node:child_process'
import type { SpawnExtra } from '@socketsecurity/lib-stable/process/spawn/types'

/**
 * Helper to spawn cdxgen with dlx. If SOCKET_CLI_CDXGEN_LOCAL_PATH environment
 * variable is set, uses the local cdxgen binary at that path instead of
 * downloading from npm.
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

    // A local override that is a JS file needs an interpreter, and a SEA build
    // has to find one on PATH; resolve it trustedly and pass the child the
    // sanitized PATH so its own lookups cannot reach back into the checkout.
    const nodeResolution =
      detection.type === 'binary' ? undefined : await resolveNodeExecutable()
    const spawnArgs = nodeResolution ? [resolution.path, ...args] : [...args]
    const spawnCommand = nodeResolution?.executable ?? resolution.path
    const baseEnv = {
      ...process.env,
      ...spawnEnv,
    }

    const spawnPromise = spawn(spawnCommand, spawnArgs, {
      ...dlxOptions,
      env:
        nodeResolution?.searchPath === undefined
          ? baseEnv
          : buildSystemToolEnv(baseEnv, nodeResolution.searchPath),
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
