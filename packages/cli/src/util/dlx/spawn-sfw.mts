/**
 * Spawn Socket Firewall (sfw) — the transparent proxy for npm/yarn/pnpm/etc.
 *
 * - SpawnSfwDlx: local override > Socket dlx download.
 * - SpawnSfwVfs: extract from SEA bundle, then exec.
 * - SpawnSfw: auto-detect SEA vs npm-CLI mode and dispatch.
 *
 * Sfw is a transparent proxy: args is [innerTool, innerSubcommand?, ...rest].
 * Machine-mode flags forward to the inner tool so its stdout stays pipe-safe
 * under --json. The Dlx flow stays bespoke (machine-mode + local-override both
 * apply); Vfs + auto-dispatch use the shared helpers.
 */

import { detectExecutableType } from '@socketsecurity/lib-stable/dlx/detect'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { defineAutoDispatch, defineVfsSpawn } from './define-tool-spawn.mts'
import { spawnDlx } from './spawn.mts'
import { resolveSfw } from './resolve-binary.mjs'
import {
  applyMachineModeIfActive,
  inferSubcommand,
} from '../spawn/apply-machine-mode.mts'
import { buildSystemToolEnv } from '../spawn/system-tool.mts'
import { resolveNodeExecutable } from '../spawn/spawn-node.mts'

import type { DlxOptions, DlxSpawnResult } from './spawn.mts'
import type { StdioOptions } from 'node:child_process'
import type { SpawnExtra } from '@socketsecurity/lib-stable/process/spawn/types'

/**
 * Helper to spawn Socket Firewall (sfw) with dlx. If SOCKET_CLI_SFW_LOCAL_PATH
 * environment variable is set, uses the local sfw binary at that path instead
 * of downloading from npm.
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

    // A local override that is a JS file needs an interpreter, and a SEA build
    // has to find one on PATH; resolve it trustedly and pass the child the
    // sanitized PATH so its own lookups cannot reach back into the checkout.
    const nodeResolution =
      detection.type === 'binary' ? undefined : await resolveNodeExecutable()
    const spawnArgs = nodeResolution
      ? [resolution.path, ...effectiveArgs]
      : [...effectiveArgs]
    const spawnCommand = nodeResolution?.executable ?? resolution.path
    const baseEnv = {
      ...process.env,
      ...innerApplied.env,
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

export const spawnSfwVfs = defineVfsSpawn('sfw')

export const spawnSfw = defineAutoDispatch({
  vfs: spawnSfwVfs,
  dlx: spawnSfwDlx,
})
