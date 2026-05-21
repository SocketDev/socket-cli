/**
 * Spawn socket-patch (Rust binary) for applying Socket-managed patches.
 *
 * - SpawnSocketPatchDlx: local override > GitHub release download > legacy npm
 *   dlx fallback.
 * - SpawnSocketPatchVfs: extract from SEA bundle, then exec.
 * - SpawnSocketPatch: auto-detect SEA vs npm-CLI mode and dispatch.
 *
 * The Dlx flow is bespoke (three-way dispatch local / GitHub-release / legacy
 * npm fallback). Vfs + auto-dispatch use the shared helpers.
 */

import { detectExecutableType } from '@socketsecurity/lib-stable/dlx/detect'
import { spawn } from '@socketsecurity/lib-stable/spawn/spawn'

import { defineAutoDispatch, defineVfsSpawn } from './define-tool-spawn.mts'
import { downloadGitHubReleaseBinary, spawnDlx } from './spawn.mts'
import { resolveSocketPatch } from './resolve-binary.mjs'

import type { DlxOptions, DlxSpawnResult } from './spawn.mts'
import type { StdioOptions } from 'node:child_process'
import type { SpawnExtra } from '@socketsecurity/lib-stable/spawn/types'

/**
 * Spawn socket-patch via dlx (npm CLI mode).
 *
 * If SOCKET_CLI_SOCKET_PATCH_LOCAL_PATH is set in the environment, runs the
 * socket-patch binary at that path instead of downloading.
 *
 * Note: As of v2.0.0, socket-patch is a Rust binary downloaded from GitHub
 * releases, not an npm package. This function handles both local overrides and
 * GitHub downloads.
 */
export async function spawnSocketPatchDlx(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  const resolution = resolveSocketPatch()
  const { env: spawnEnv, ...dlxOptions } = {
    __proto__: null,
    ...options,
  } as DlxOptions

  // Use local socket-patch if available.
  if (resolution.type === 'local') {
    const detection = detectExecutableType(resolution.path)

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

  // Download from GitHub releases (socket-patch v2.0.0+).
  if (resolution.type === 'github-release') {
    const binaryPath = await downloadGitHubReleaseBinary(resolution.details)

    const spawnPromise = spawn(binaryPath, args, {
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

  // Fallback to dlx for npm packages (not used for socket-patch v2.0.0+).
  return await spawnDlx(
    resolution.details,
    args,
    { force: false, ...options },
    spawnExtra,
  )
}

export const spawnSocketPatchVfs = defineVfsSpawn('socket-patch')

export const spawnSocketPatch = defineAutoDispatch({
  vfs: spawnSocketPatchVfs,
  dlx: spawnSocketPatchDlx,
})
