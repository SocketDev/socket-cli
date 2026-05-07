/**
 * Spawn Socket Firewall (sfw) — the transparent proxy for npm/yarn/pnpm/etc.
 *
 * - spawnSfwDlx: local override > Socket dlx download.
 * - spawnSfwVfs: extract from SEA bundle, then exec.
 * - spawnSfw: auto-detect SEA vs npm-CLI mode and dispatch.
 *
 * sfw is a transparent proxy: args is [innerTool, innerSubcommand?, ...rest].
 * Machine-mode flags forward to the inner tool so its stdout stays pipe-safe
 * under --json.
 */

import { detectExecutableType } from '@socketsecurity/lib/dlx/detect'
import { spawn } from '@socketsecurity/lib/spawn'

import { spawnDlx, spawnToolVfs } from './spawn.mts'
import { resolveSfw } from './resolve-binary.mjs'
import { areExternalToolsAvailable } from './vfs-extract.mjs'
import { isSeaBinary } from '../sea/detect.mts'
import {
  applyMachineModeIfActive,
  inferSubcommand,
} from '../spawn/apply-machine-mode.mts'

import type { DlxOptions, DlxSpawnResult } from './spawn.mts'
import type { StdioOptions } from 'node:child_process'
import type { SpawnExtra } from '@socketsecurity/lib/spawn'

/**
 * Helper to spawn Socket Firewall (sfw) with dlx.
 * If SOCKET_CLI_SFW_LOCAL_PATH environment variable is set, uses the local
 * sfw binary at that path instead of downloading from npm.
 */
export async function spawnSfwDlx(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  const [innerTool, ...innerArgs] = args
  const innerSubcommand = inferSubcommand(innerArgs)
  const innerApplied = innerTool
    ? applyMachineModeIfActive({
        args: innerArgs,
        env: undefined,
        subcommand: innerSubcommand,
        tool: innerTool,
      })
    : { args: [...innerArgs], env: {} }
  const effectiveArgs = innerTool
    ? [innerTool, ...innerApplied.args]
    : [...args]

  const resolution = resolveSfw()

  // Use local sfw if available.
  if (resolution.type === 'local') {
    const detection = detectExecutableType(resolution.path)
    const { env: spawnEnv, ...dlxOptions } = {
      __proto__: null,
      ...options,
    } as DlxOptions

    const spawnArgs =
      detection.type === 'binary'
        ? effectiveArgs
        : [resolution.path, ...effectiveArgs]
    const spawnCommand = detection.type === 'binary' ? resolution.path : 'node'

    const spawnPromise = spawn(spawnCommand, spawnArgs, {
      ...dlxOptions,
      env: {
        ...process.env,
        ...innerApplied.env,
        ...spawnEnv,
      },
      stdio: (spawnExtra?.['stdio'] as StdioOptions | undefined) ?? 'inherit',
    })

    return {
      spawnPromise,
    }
  }

  // Use dlx version (resolveSfw only returns 'local' or 'dlx' types).
  if (resolution.type !== 'dlx') {
    throw new Error(
      `internal: resolveSfw returned resolution.type="${resolution.type}" (expected "dlx"); this is a resolver contract bug — re-run with --debug and report the output`,
    )
  }
  return await spawnDlx(
    resolution.details,
    effectiveArgs,
    {
      force: false,
      ...options,
      env: {
        ...innerApplied.env,
        ...options?.env,
      },
    },
    spawnExtra,
  )
}

/**
 * Helper to spawn Socket Firewall (sfw) from VFS.
 * Used when running in SEA mode.
 */
export async function spawnSfwVfs(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  return await spawnToolVfs('sfw', args, options, spawnExtra)
}

/**
 * Spawn Socket Firewall (sfw).
 * Auto-detects SEA mode and uses appropriate spawn method.
 */
export async function spawnSfw(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  if (isSeaBinary() && areExternalToolsAvailable()) {
    return await spawnSfwVfs(args, options, spawnExtra)
  }
  return await spawnSfwDlx(args, options, spawnExtra)
}
