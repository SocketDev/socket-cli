/** @fileoverview Coana CLI spawn utilities for Socket CLI. */

import { spawn } from '@socketsecurity/registry/lib/spawn'

import { getDefaultOrgSlug } from '../commands/ci/fetch-default-org-slug.mts'
import constants from '../constants.mts'
import { getErrorCause } from './errors.mts'
import { getDefaultApiToken, getDefaultProxyUrl } from './sdk.mts'
import { runShadowCommand } from './shadow-runner.mts'

import type { ShadowBinOptions } from '../shadow/npm-base.mts'
import type { CResult } from '../types.mts'
import type { SpawnExtra } from '@socketsecurity/registry/lib/spawn'

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
  orgSlug?: string | undefined,
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

    // Use npm/dlx version via shadow-runner.
    const coanaVersion =
      constants.ENV['INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION']
    const packageSpec = `@coana-tech/cli@~${coanaVersion}`

    const finalEnv = {
      ...process.env,
      ...constants.processEnv,
      ...mixinsEnv,
      ...spawnEnv,
    }

    const result = await runShadowCommand(packageSpec, args, {
      agent,
      cwd:
        typeof shadowOptions.cwd === 'string'
          ? shadowOptions.cwd
          : shadowOptions.cwd?.toString(),
      env: finalEnv as Record<string, string>,
      ipc,
      stdio: spawnExtra?.['stdio'] || 'inherit',
    })

    return result
  } catch (e) {
    const stderr = (e as { stderr?: unknown })?.stderr
    const cause = getErrorCause(e)
    const message = stderr ? String(stderr) : cause
    return {
      ok: false,
      data: e,
      message,
    }
  }
}
