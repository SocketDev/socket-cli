/** @fileoverview Coana CLI spawn utilities for Socket CLI. */

import { createRequire } from 'node:module'

import { spawn } from '@socketsecurity/registry/lib/spawn'

import { getDefaultOrgSlug } from '../commands/ci/fetch-default-org-slug.mts'
import constants, { FLAG_SILENT, NPM, PNPM, YARN } from '../constants.mts'
import { getErrorCause } from './errors.mts'
import { findUp } from './fs.mts'
import { getDefaultApiToken, getDefaultProxyUrl } from './sdk.mts'
import { isYarnBerry } from './yarn-version.mts'

import type { ShadowBinOptions, ShadowBinResult } from '../shadow/npm-base.mts'
import type { CResult } from '../types.mts'
import type { SpawnExtra } from '@socketsecurity/registry/lib/spawn'

const require = createRequire(import.meta.url)

const { PACKAGE_LOCK_JSON, PNPM_LOCK_YAML, YARN_LOCK } = constants

export type CoanaSpawnOptions = ShadowBinOptions & {
  agent?: 'npm' | 'pnpm' | 'yarn' | undefined
}

/**
 * Helper to spawn coana with package manager dlx commands.
 * Returns a CResult with stdout extraction for backward compatibility.
 *
 * If SOCKET_CLI_COANA_LOCAL_PATH environment variable is set, uses the local
 * Coana CLI at that path instead of downloading from npm.
 */
export async function spawnCoana(
  args: string[] | readonly string[],
  orgSlug?: string,
  options?: CoanaSpawnOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<CResult<string>> {
  const {
    agent,
    env: spawnEnv,
    ipc,
    ...shadowOptions
  } = {
    __proto__: null,
    ...options,
  } as CoanaSpawnOptions

  const mixinsEnv: Record<string, string> = {
    SOCKET_CLI_VERSION: constants.ENV['INLINED_SOCKET_CLI_VERSION'],
  }
  const defaultApiToken = getDefaultApiToken()
  if (defaultApiToken) {
    mixinsEnv['SOCKET_CLI_API_TOKEN'] = defaultApiToken
  }

  if (orgSlug) {
    mixinsEnv['SOCKET_ORG_SLUG'] = orgSlug
  } else {
    const orgSlugCResult = await getDefaultOrgSlug()
    if (orgSlugCResult.ok) {
      mixinsEnv['SOCKET_ORG_SLUG'] = orgSlugCResult.data
    }
  }

  const proxyUrl = getDefaultProxyUrl()
  if (proxyUrl) {
    mixinsEnv['SOCKET_CLI_API_PROXY'] = proxyUrl
  }

  try {
    const localCoanaPath = constants.ENV['SOCKET_CLI_COANA_LOCAL_PATH']
    // Use local Coana CLI if path is provided.
    if (localCoanaPath) {
      const finalEnv = {
        ...process.env,
        ...constants.processEnv,
        ...mixinsEnv,
        ...spawnEnv,
      }
      const spawnResult = await spawn('node', [localCoanaPath, ...args], {
        cwd: shadowOptions.cwd,
        env: finalEnv,
        stdio: spawnExtra?.['stdio'] || 'inherit',
      })

      return {
        ok: true,
        data: spawnResult.stdout ? spawnResult.stdout.toString() : '',
      }
    }

    // Auto-detect package manager if not specified.
    let pm = agent
    if (!pm) {
      const pnpmLockPath = await findUp(PNPM_LOCK_YAML, { onlyFiles: true })
      const yarnLockPath = pnpmLockPath
        ? undefined
        : await findUp(YARN_LOCK, { onlyFiles: true })
      const npmLockPath =
        pnpmLockPath || yarnLockPath
          ? undefined
          : await findUp(PACKAGE_LOCK_JSON, { onlyFiles: true })

      if (pnpmLockPath) {
        pm = PNPM
      } else if (yarnLockPath) {
        pm = YARN
      } else if (npmLockPath) {
        pm = NPM
      } else {
        // Default to npm if no lockfile found.
        pm = NPM
      }
    }

    // Use npm/dlx version.
    const coanaVersion =
      constants.ENV['INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION']
    const coanaArgs = [`@coana-tech/cli@~${coanaVersion}`, ...args]

    const finalEnv = {
      ...process.env,
      ...constants.processEnv,
      ...mixinsEnv,
      ...spawnEnv,
    }

    const finalIpc = {
      [constants.SOCKET_CLI_SHADOW_ACCEPT_RISKS]: true,
      [constants.SOCKET_CLI_SHADOW_API_TOKEN]:
        constants.SOCKET_PUBLIC_API_TOKEN,
      [constants.SOCKET_CLI_SHADOW_SILENT]: true,
      ...ipc,
    }

    let result: ShadowBinResult
    if (pm === PNPM) {
      const shadowPnpmBin = /*@__PURE__*/ require(constants.shadowPnpmBinPath)
      result = await shadowPnpmBin(
        ['dlx', FLAG_SILENT, ...coanaArgs],
        {
          ...shadowOptions,
          env: finalEnv,
          ipc: finalIpc,
        },
        spawnExtra,
      )
    } else if (pm === YARN && isYarnBerry()) {
      const shadowYarnBin = /*@__PURE__*/ require(constants.shadowYarnBinPath)
      result = await shadowYarnBin(
        ['dlx', '--quiet', ...coanaArgs],
        {
          ...shadowOptions,
          env: finalEnv,
          ipc: finalIpc,
        },
        spawnExtra,
      )
    } else {
      const shadowNpxBin = /*@__PURE__*/ require(constants.shadowNpxBinPath)
      result = await shadowNpxBin(
        ['--yes', '--force', FLAG_SILENT, ...coanaArgs],
        {
          ...shadowOptions,
          env: finalEnv,
          ipc: finalIpc,
        },
        spawnExtra,
      )
    }

    const output = await result.spawnPromise
    return { ok: true, data: output.stdout.toString() }
  } catch (e) {
    const stderr = (e as any)?.stderr
    const cause = getErrorCause(e)
    const message = stderr || cause
    return {
      ok: false,
      data: e,
      message,
    }
  }
}
