/**
 * @fileoverview Shadow bin runner with IPC support and error handling.
 *
 * NOTE: This module no longer uses package manager-specific dlx commands (npx/pnpm dlx/yarn dlx).
 * Instead, it uses direct npx execution for all package installations, ensuring consistent
 * behavior across different package manager environments.
 */

import { createRequire } from 'node:module'

import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../constants.mts'
import { getErrorCause } from './errors.mts'
import { startSpinner } from './spinner.mts'

import type { IpcObject } from '../constants.mts'
import type { ShadowBinOptions, ShadowBinResult } from '../shadow/npm-base.mts'
import type { CResult } from '../types.mts'
import type { SpawnExtra } from '@socketsecurity/registry/lib/spawn'

const require = createRequire(import.meta.url)

const { WIN32 } = constants

export type ShadowRunnerOptions = {
  agent?: 'npm' | 'pnpm' | 'yarn' | undefined
  bufferOutput?: boolean | undefined
  cwd?: string | undefined
  env?: Record<string, string> | undefined
  ipc?: IpcObject | undefined
  showSpinner?: boolean | undefined
  spinnerMessage?: string | undefined
  stdio?: 'inherit' | 'pipe' | undefined
}

/**
 * Run a command via npx (no longer uses shadow binaries or package manager-specific dlx).
 * Uses direct npx execution for consistent behavior across all environments.
 *
 * Note: The `agent` option is now ignored - we always use npx.
 */
export async function runShadowCommand(
  packageSpec: string,
  args: string[] | readonly string[],
  options?: ShadowRunnerOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<CResult<string>> {
  const opts = { __proto__: null, ...options } as ShadowRunnerOptions

  const finalEnv = {
    ...process.env,
    ...opts.env,
  }

  const finalStdio = spawnExtra?.['stdio'] || opts.stdio || 'inherit'

  let stopSpinner: (() => void) | undefined

  try {
    if (opts.showSpinner && opts.spinnerMessage) {
      stopSpinner = startSpinner(opts.spinnerMessage)
    }

    // Use npx directly instead of shadow binaries
    const npxArgs = ['--yes', packageSpec, ...args]

    const result = await spawn('npx', npxArgs, {
      cwd: opts.cwd,
      env: finalEnv,
      shell: WIN32,
      stdio: finalStdio,
    })

    if (stopSpinner) {
      stopSpinner()
      stopSpinner = undefined
    }

    const stdout = result.stdout ? result.stdout.toString() : ''

    if (result.code !== 0) {
      const stderr = result.stderr ? result.stderr.toString() : ''
      return {
        ok: false,
        code: result.code || 1,
        data: result,
        message: stderr || `Command exited with code ${result.code}`,
      }
    }

    return { ok: true, data: stdout }
  } catch (e) {
    if (stopSpinner) {
      stopSpinner()
    }

    const stderr = (e as { stderr?: unknown })?.stderr
    const cause = getErrorCause(e)
    const message = stderr ? String(stderr) : cause

    return {
      ok: false,
      code: (e as { code?: number })?.code ?? 1,
      data: e,
      message,
    }
  }
}

/**
 * Run npm command via shadow npm wrapper.
 */
export async function runShadowNpm(
  args: string[] | readonly string[],
  options?: ShadowRunnerOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<CResult<string>> {
  const opts = { __proto__: null, ...options } as ShadowRunnerOptions

  const shadowOpts: ShadowBinOptions = {
    cwd: opts.cwd,
    env: opts.env,
    ipc: {
      [constants.SOCKET_CLI_SHADOW_ACCEPT_RISKS]: true,
      [constants.SOCKET_CLI_SHADOW_API_TOKEN]:
        constants.SOCKET_PUBLIC_API_TOKEN,
      [constants.SOCKET_CLI_SHADOW_SILENT]: true,
      ...opts.ipc,
    },
    stdio: opts.stdio || 'inherit',
  }

  let stopSpinner: (() => void) | undefined

  try {
    if (opts.showSpinner && opts.spinnerMessage) {
      stopSpinner = startSpinner(opts.spinnerMessage)
    }

    const shadowNpmBin = /*@__PURE__*/ require(constants.shadowNpmBinPath)
    const result: ShadowBinResult = await shadowNpmBin(
      args,
      shadowOpts,
      spawnExtra,
    )

    if (stopSpinner) {
      stopSpinner()
      stopSpinner = undefined
    }

    const output = await result.spawnPromise
    return { ok: true, data: output.stdout.toString() }
  } catch (e) {
    if (stopSpinner) {
      stopSpinner()
    }

    const stderr = (e as { stderr?: unknown })?.stderr
    const cause = getErrorCause(e)
    const message = stderr ? String(stderr) : cause

    return {
      ok: false,
      code: (e as { code?: number })?.code ?? 1,
      data: e,
      message,
    }
  }
}
