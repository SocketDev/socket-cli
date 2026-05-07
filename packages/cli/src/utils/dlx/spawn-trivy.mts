/**
 * Spawn Trivy for image / IaC vulnerability scanning.
 *
 * - spawnTrivyDlx: download from GitHub releases, then exec.
 * - spawnTrivyVfs: extract from SEA bundle, then exec.
 * - spawnTrivy: auto-detect SEA vs npm-CLI mode and dispatch.
 */

import { spawn } from '@socketsecurity/lib/spawn'

import {
  downloadGitHubReleaseBinary,
  spawnToolVfs,
} from './spawn.mts'
import { resolveTrivy } from './resolve-binary.mjs'
import { areExternalToolsAvailable } from './vfs-extract.mjs'
import { isSeaBinary } from '../sea/detect.mts'

import type { DlxOptions, DlxSpawnResult } from './spawn.mts'
import type { StdioOptions } from 'node:child_process'
import type { SpawnExtra } from '@socketsecurity/lib/spawn'

export async function spawnTrivyDlx(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  const resolution = resolveTrivy()

  if (resolution.type !== 'github-release') {
    throw new Error(
      `internal: resolveTrivy returned resolution.type="${resolution.type}" (expected "github-release"); this is a resolver contract bug — re-run with --debug and report the output`,
    )
  }

  const { env: spawnEnv, ...dlxOptions } = {
    __proto__: null,
    ...options,
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

  return {
    spawnPromise,
  }
}

/**
 * Spawn Trivy from VFS (SEA mode).
 */
export async function spawnTrivyVfs(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  return await spawnToolVfs('trivy', args, options, spawnExtra)
}

/**
 * Spawn Trivy.
 * Auto-detects SEA mode and uses appropriate spawn method.
 */
export async function spawnTrivy(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  if (isSeaBinary() && areExternalToolsAvailable()) {
    return await spawnTrivyVfs(args, options, spawnExtra)
  }
  return await spawnTrivyDlx(args, options, spawnExtra)
}
