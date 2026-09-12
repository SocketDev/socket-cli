import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { downloadGitHubReleaseBinary } from './spawn.mts'

import type { DlxOptions, DlxSpawnResult } from './spawn.mts'
import type { BinaryResolution } from './resolve-binary.mts'

import type { StdioOptions } from 'node:child_process'
import type { SpawnExtra } from '@socketsecurity/lib-stable/process/spawn/types'

/**
 * Argument shape for every spawn function the factory emits.
 */
export type ToolSpawnFn = (
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
) => Promise<DlxSpawnResult>

export function capitalize(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s
}

/**
 * Build a npm-CLI-mode spawner for a tool that ships strictly via GitHub
 * releases, trufflehog, trivy, opengrep. Throws a clearly-attributed
 * resolver-contract error if the resolver returns a non-github-release type.
 */
export function defineGitHubReleaseSpawn(config: {
  toolName: string
  resolve: () => BinaryResolution
}): ToolSpawnFn {
  const { resolve, toolName } = {
    __proto__: null,
    ...config,
  } as typeof config
  return async (args, dlxCallOptions, spawnExtra) => {
    const resolution = resolve()

    if (resolution.type !== 'github-release') {
      throw new Error(
        `internal: resolve${capitalize(toolName)} returned resolution.type="${resolution.type}" (expected "github-release"); this is a resolver contract bug — re-run with --debug and report the output`,
      )
    }

    const { env: spawnEnv, ...dlxOptions } = {
      __proto__: null,
      ...dlxCallOptions,
    } as DlxOptions

    const binaryPath = await downloadGitHubReleaseBinary(resolution.details)

    const spawnPromise = spawn(binaryPath, args, {
      ...dlxOptions,
      env: {
        ...process.env,
        ...spawnEnv,
      },
      stdio: (spawnExtra?.['stdio'] as StdioOptions | undefined) ?? 'inherit',
    })

    return { __proto__: null, spawnPromise }
  }
}
