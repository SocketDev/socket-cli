/** @fileoverview Socket Patch CLI spawn utilities for Socket CLI. */

import { dlxPackage } from '@socketsecurity/lib/dlx/package'

import { getDefaultOrgSlug } from '../../commands/ci/fetch-default-org-slug.mts'
import ENV from '../../constants/env.mts'
import { getErrorCause } from '../error/errors.mts'
import { getDefaultApiToken, getDefaultProxyUrl } from '../socket/sdk.mts'
import { spawnNode } from '../spawn/spawn-node.mjs'

import type { ShadowBinOptions } from '../../shadow/npm-base.mjs'
import type { CResult } from '../../types.mjs'
import type { SpawnExtra } from '@socketsecurity/lib/spawn'

export type SocketPatchSpawnOptions = ShadowBinOptions

/**
 * Helper to spawn socket-patch with package manager dlx commands.
 * Returns a CResult with stdout extraction for backward compatibility.
 *
 * If SOCKET_CLI_SOCKET_PATCH_LOCAL_PATH environment variable is set, uses the local
 * Socket Patch CLI at that path instead of downloading from npm.
 */
export async function spawnSocketPatch(
  args: string[] | readonly string[],
  orgSlug?: string,
  options?: SocketPatchSpawnOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<CResult<string>> {
  const { env: spawnEnv, ...shadowOptions } = {
    __proto__: null,
    ...options,
  } as SocketPatchSpawnOptions

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

  // Forward SOCKET_PATCH_PROXY_URL if set.
  if (ENV.SOCKET_PATCH_PROXY_URL) {
    mixinsEnv['SOCKET_PATCH_PROXY_URL'] = ENV.SOCKET_PATCH_PROXY_URL
  }

  try {
    const localSocketPatchPath = ENV.SOCKET_CLI_SOCKET_PATCH_LOCAL_PATH
    // Use local Socket Patch CLI if path is provided.
    if (localSocketPatchPath) {
      const spawnResult = await spawnNode([localSocketPatchPath, ...args], {
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
    const socketPatchVersion = ENV.INLINED_SOCKET_CLI_SOCKET_PATCH_VERSION
    const packageSpec = `@socketsecurity/socket-patch@${socketPatchVersion}`

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
