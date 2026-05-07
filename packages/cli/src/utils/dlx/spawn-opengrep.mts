/**
 * Spawn OpenGrep for AST-based code-pattern scanning.
 *
 * - spawnOpengrepDlx: download from GitHub releases, then exec.
 * - spawnOpengrepVfs: extract from SEA bundle, then exec.
 * - spawnOpengrep: auto-detect SEA vs npm-CLI mode and dispatch.
 */

import { spawn } from '@socketsecurity/lib/spawn'

import {
  downloadGitHubReleaseBinary,
  spawnToolVfs,
} from './spawn.mts'
import { resolveOpengrep } from './resolve-binary.mjs'
import { areExternalToolsAvailable } from './vfs-extract.mjs'
import { isSeaBinary } from '../sea/detect.mts'

import type { DlxOptions, DlxSpawnResult } from './spawn.mts'
import type { StdioOptions } from 'node:child_process'
import type { SpawnExtra } from '@socketsecurity/lib/spawn'

export async function spawnOpengrepDlx(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  const resolution = resolveOpengrep()

  if (resolution.type !== 'github-release') {
    throw new Error(
      `internal: resolveOpengrep returned resolution.type="${resolution.type}" (expected "github-release"); this is a resolver contract bug — re-run with --debug and report the output`,
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
 * Spawn OpenGrep from VFS (SEA mode).
 */
export async function spawnOpengrepVfs(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  return await spawnToolVfs('opengrep', args, options, spawnExtra)
}

/**
 * Spawn OpenGrep.
 * Auto-detects SEA mode and uses appropriate spawn method.
 */
export async function spawnOpengrep(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  if (isSeaBinary() && areExternalToolsAvailable()) {
    return await spawnOpengrepVfs(args, options, spawnExtra)
  }
  return await spawnOpengrepDlx(args, options, spawnExtra)
}
