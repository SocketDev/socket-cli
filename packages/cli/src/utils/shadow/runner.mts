/** @fileoverview Shadow bin runner with IPC support and error handling. */

import { SOCKET_PUBLIC_API_TOKEN } from '@socketsecurity/lib/constants/socket'
import { Spinner as createSpinner } from '@socketsecurity/lib/spinner'

import { NPM, PNPM, YARN } from '../../constants/agents.mts'
import {
  PACKAGE_LOCK_JSON,
  PNPM_LOCK_YAML,
  YARN_LOCK,
} from '../../constants/packages.mts'
import {
  SOCKET_CLI_SHADOW_ACCEPT_RISKS,
  SOCKET_CLI_SHADOW_API_TOKEN,
  SOCKET_CLI_SHADOW_SILENT,
} from '../../constants/shadow.mts'
import shadowNpmBin from '../../shadow/npm/bin.mts'
import { getErrorCause } from '../error/errors.mts'
import { findUp } from '../fs/find-up.mts'

import type { IpcObject } from '../../constants/shadow.mts'
import type {
  ShadowBinOptions,
  ShadowBinResult,
} from '../../shadow/npm-base.mts'
import type { CResult } from '../../types.mts'
import type { SpawnExtra } from '@socketsecurity/lib/spawn'
import type { Spinner } from '@socketsecurity/lib/spinner'

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
 * Auto-detect package manager based on lockfiles.
 */
export async function detectPackageManager(
  cwd?: string | undefined,
): Promise<'npm' | 'pnpm' | 'yarn'> {
  const pnpmLockPath = await findUp(PNPM_LOCK_YAML, {
    cwd,
    onlyFiles: true,
  })
  const yarnLockPath = pnpmLockPath
    ? undefined
    : await findUp(YARN_LOCK, { cwd, onlyFiles: true })
  const npmLockPath =
    pnpmLockPath || yarnLockPath
      ? undefined
      : await findUp(PACKAGE_LOCK_JSON, { cwd, onlyFiles: true })

  if (pnpmLockPath) {
    return PNPM
  }
  if (yarnLockPath) {
    return YARN
  }
  if (npmLockPath) {
    return NPM
  }
  // Default to npm if no lockfile found.
  return NPM
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
      [SOCKET_CLI_SHADOW_ACCEPT_RISKS]: true,
      [SOCKET_CLI_SHADOW_API_TOKEN]: SOCKET_PUBLIC_API_TOKEN,
      [SOCKET_CLI_SHADOW_SILENT]: true,
      ...opts.ipc,
    },
    stdio: opts.stdio || 'inherit',
  }

  let spinner: Spinner | undefined

  try {
    if (opts.showSpinner && opts.spinnerMessage) {
      spinner = createSpinner()
      spinner.start(opts.spinnerMessage)
    }

    const result: ShadowBinResult = await shadowNpmBin(
      args,
      shadowOpts,
      spawnExtra,
    )

    if (spinner) {
      spinner.stop()
      spinner = undefined
    }

    const output = await result.spawnPromise
    return { ok: true, data: output.stdout?.toString() ?? '' }
  } catch (e) {
    if (spinner) {
      spinner.stop()
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
