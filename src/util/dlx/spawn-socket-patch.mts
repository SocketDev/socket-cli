import { detectExecutableType } from '@socketsecurity/lib-stable/dlx/detect'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { downloadGitHubReleaseBinary } from './spawn.mts'
import { resolveSocketPatch } from './resolve-binary.mjs'
import { getExecPath } from '@socketsecurity/lib-stable/constants/node'

import type { DlxOptions, DlxSpawnResult } from './spawn.mts'
import type { StdioOptions } from 'node:child_process'
import type { SpawnExtra } from '@socketsecurity/lib-stable/process/spawn/types'

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
export async function spawnSocketPatch(
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

    const nodeResolution =
      detection.type === 'binary' ? undefined : getExecPath()
    const spawnArgs = nodeResolution ? [resolution.path, ...args] : [...args]
    const spawnCommand = nodeResolution ?? resolution.path
    const baseEnv = {
      ...process.env,
      ...spawnEnv,
    }

    const spawnPromise = spawn(spawnCommand, spawnArgs, {
      ...dlxOptions,
      env: baseEnv,
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

  throw new Error(`Unsupported socket-patch resolution: ${resolution.type}`)
}
