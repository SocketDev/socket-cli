import { detectExecutableType } from '@socketsecurity/lib-stable/dlx/detect'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { downloadGitHubReleaseBinary } from '../../util/dlx/spawn.mts'
import { resolveSocketPatch } from '../../util/dlx/resolve-binary.mjs'
import { getExecPath } from '@socketsecurity/lib-stable/constants/node'

import type { DlxOptions, DlxSpawnResult } from '../../util/dlx/spawn.mts'
import type { StdioOptions } from 'node:child_process'
import type { SpawnExtra } from '@socketsecurity/lib-stable/process/spawn/types'

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
