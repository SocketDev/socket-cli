/** @fileoverview Coana CLI spawn utilities for Socket CLI. */

import { dlxPackage } from '@socketsecurity/lib/dlx/package'

import { getDefaultOrgSlug } from '../../commands/ci/fetch-default-org-slug.mts'
import ENV from '../../constants/env.mts'
import { getErrorCause } from '../error/errors.mts'
import { getDefaultApiToken, getDefaultProxyUrl } from '../socket/sdk.mts'
import { spawnNode } from '../spawn/spawn-node.mjs'

import type { ShadowBinOptions } from '../../shadow/npm-base.mjs'
import type { CResult } from '../../types.mjs'
import type { SpawnExtra } from '@socketsecurity/lib/spawn'

export type CoanaSpawnOptions = ShadowBinOptions

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
  const { env: spawnEnv, ...shadowOptions } = {
    __proto__: null,
    ...options,
  } as CoanaSpawnOptions

  const mixinsEnv: Record<string, string> = {
    SOCKET_CLI_VERSION: ENV.INLINED_SOCKET_CLI_VERSION || '',
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
    const localCoanaPath = ENV.SOCKET_CLI_COANA_LOCAL_PATH
    // Use local Coana CLI if path is provided.
    if (localCoanaPath) {
      const spawnResult = await spawnNode([localCoanaPath, ...args], {
        ...shadowOptions,
        env: {
          ...process.env,
          ...mixinsEnv,
          ...spawnEnv,
        },
        stdio: spawnExtra?.['stdio'] || 'inherit',
      })

      return {
        ok: true,
        data: spawnResult.stdout?.toString() ?? '',
      }
    }

    // Use dlx version.
    const coanaVersion = ENV.INLINED_SOCKET_CLI_COANA_VERSION
    const packageSpec = `@coana-tech/cli@${coanaVersion}`

    const finalEnv = {
      ...process.env,
      ...mixinsEnv,
      ...spawnEnv,
    }

    const result = await dlxPackage(
      args,
      {
        package: packageSpec,
        force: true,
        spawnOptions: {
          cwd:
            typeof shadowOptions.cwd === 'string'
              ? shadowOptions.cwd
              : shadowOptions.cwd?.toString(),
          env: finalEnv as Record<string, string>,
          stdio:
            (spawnExtra?.['stdio'] as 'inherit' | 'pipe' | undefined) ||
            'inherit',
        },
      },
      spawnExtra,
    )

    const output = await result.spawnPromise
    return {
      ok: true,
      data: output.stdout?.toString() ?? '',
    }
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
