/** @fileoverview Shadow bin runner with IPC support and error handling. */

import { createRequire } from 'node:module'

import { SOCKET_PUBLIC_API_TOKEN } from '@socketsecurity/lib/constants/socket'
import { Spinner as createSpinner } from '@socketsecurity/lib/spinner'

import { NPM, PNPM, YARN } from '../../constants/agents.mts'
import { FLAG_SILENT } from '../../constants/cli.mts'
import {
  PACKAGE_LOCK_JSON,
  PNPM_LOCK_YAML,
  YARN_LOCK,
} from '../../constants/packages.mts'
import {
  getShadowNpmBinPath,
  getShadowNpxBinPath,
  SOCKET_CLI_SHADOW_ACCEPT_RISKS,
  SOCKET_CLI_SHADOW_API_TOKEN,
  SOCKET_CLI_SHADOW_SILENT,
} from '../../constants/shadow.mts'
import { getErrorCause } from '../error/errors.mts'
import { findUp } from '../fs/find-up.mts'
import { isYarnBerry } from '../yarn/version.mts'

import type { IpcObject } from '../../constants/shadow.mts'
import type {
  ShadowBinOptions,
  ShadowBinResult,
} from '../../shadow/npm-base.mts'
import type { CResult } from '../../types.mts'
import type { SpawnExtra } from '@socketsecurity/lib/spawn'
import type { Spinner } from '@socketsecurity/lib/spinner'

const require = createRequire(import.meta.url)

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
 * Run a command via package manager dlx/npx with shadow bin wrapping.
 * Handles IPC for secure config passing and provides unified error handling.
 */
export async function runShadowCommand(
  packageSpec: string,
  args: string[] | readonly string[],
  options?: ShadowRunnerOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<CResult<string>> {
  const opts = { __proto__: null, ...options } as ShadowRunnerOptions
  const agent = opts.agent ?? (await detectPackageManager(opts.cwd))

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

  const finalSpawnExtra: SpawnExtra = {
    stdio: spawnExtra?.['stdio'] || shadowOpts['stdio'],
    ...spawnExtra,
  }

  let spinner: Spinner | undefined

  try {
    if (opts.showSpinner && opts.spinnerMessage) {
      spinner = createSpinner()
      spinner.start(opts.spinnerMessage)
    }

    let result: ShadowBinResult

    // Note: pnpm and yarn no longer use shadow binaries.
    // They use dlx directly without interception.
    // Only npm/npx still use shadow binaries for legacy compatibility.
    if (agent === PNPM || (agent === YARN && isYarnBerry())) {
      // For pnpm and yarn, use npx as fallback since they don't have shadow binaries.
      // In practice, callers of runShadowCommand should migrate to direct dlx calls.
      const shadowNpxBin = /*@__PURE__*/ require(getShadowNpxBinPath())
      result = await shadowNpxBin(
        ['--yes', '--force', FLAG_SILENT, packageSpec, ...args],
        shadowOpts,
        finalSpawnExtra,
      )
    } else {
      const shadowNpxBin = /*@__PURE__*/ require(getShadowNpxBinPath())
      result = await shadowNpxBin(
        ['--yes', '--force', FLAG_SILENT, packageSpec, ...args],
        shadowOpts,
        finalSpawnExtra,
      )
    }

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

    const shadowNpmBin = /*@__PURE__*/ require(getShadowNpmBinPath())
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
