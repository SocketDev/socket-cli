/**
 * Spawn TruffleHog for secret-scanning runs.
 *
 * - spawnTrufflehogDlx: download from GitHub releases, then exec.
 * - spawnTrufflehogVfs: extract from SEA bundle, then exec.
 * - spawnTrufflehog: auto-detect SEA vs npm-CLI mode and dispatch.
 */

import { spawn } from '@socketsecurity/lib/spawn'

import {
  downloadGitHubReleaseBinary,
  spawnToolVfs,
} from './spawn.mts'
import { resolveTrufflehog } from './resolve-binary.mjs'
import { areExternalToolsAvailable } from './vfs-extract.mjs'
import { isSeaBinary } from '../sea/detect.mts'

import type { DlxOptions, DlxSpawnResult } from './spawn.mts'
import type { StdioOptions } from 'node:child_process'
import type { SpawnExtra } from '@socketsecurity/lib/spawn'

export async function spawnTrufflehogDlx(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  const resolution = resolveTrufflehog()

  if (resolution.type !== 'github-release') {
    throw new Error(
      `internal: resolveTrufflehog returned resolution.type="${resolution.type}" (expected "github-release"); this is a resolver contract bug — re-run with --debug and report the output`,
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
 * Spawn TruffleHog from VFS (SEA mode).
 */
export async function spawnTrufflehogVfs(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  return await spawnToolVfs('trufflehog', args, options, spawnExtra)
}

/**
 * Spawn TruffleHog.
 * Auto-detects SEA mode and uses appropriate spawn method.
 */
export async function spawnTrufflehog(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  if (isSeaBinary() && areExternalToolsAvailable()) {
    return await spawnTrufflehogVfs(args, options, spawnExtra)
  }
  return await spawnTrufflehogDlx(args, options, spawnExtra)
}
