/**
 * DLX execution utilities for Socket CLI.
 * Manages package execution using Socket's own dlx implementation.
 *
 * Key Functions:
 * - spawnCdxgenDlx: Execute CycloneDX generator via dlx
 * - spawnCoanaDlx: Execute Coana CLI tool via dlx
 * - spawnDlx: Execute packages using Socket's dlx
 * - spawnSynpDlx: Execute Synp converter via dlx
 *
 * Implementation:
 * - Uses @socketsecurity/lib/dlx-package for direct package installation
 * - Installs packages to ~/.socket/_dlx directory
 * - Executes binaries directly without package manager commands
 */

import { dlxPackage } from '@socketsecurity/lib/dlx-package'
import { SOCKET_PUBLIC_API_TOKEN } from '@socketsecurity/lib/constants/socket'
import { spawn } from '@socketsecurity/lib/spawn'

import { getDefaultOrgSlug } from '../../commands/ci/fetch-default-org-slug.mjs'
import ENV from '../../constants/env.mts'
import {
  SOCKET_CLI_SHADOW_ACCEPT_RISKS,
  SOCKET_CLI_SHADOW_API_TOKEN,
  SOCKET_CLI_SHADOW_SILENT,
} from '../../constants/shadow.mts'
import { getErrorCause } from '../error/errors.mts'
import { getDefaultApiToken, getDefaultProxyUrl } from '../socket/sdk.mjs'

import type {
  ShadowBinOptions,
  ShadowBinResult,
} from '../../shadow/npm-base.mjs'
import type { CResult } from '../../types.mjs'
import type { SpawnExtra } from '@socketsecurity/lib/spawn'

export type DlxOptions = ShadowBinOptions & {
  agent?: 'npm' | 'pnpm' | 'yarn' | undefined
  force?: boolean | undefined
  silent?: boolean | undefined
}

export type DlxPackageSpec = {
  name: string
  version: string
}

/**
 * Spawns a package using Socket's dlx implementation.
 * Installs packages to ~/.socket/_dlx and executes them directly.
 */
export async function spawnDlx(
  packageSpec: DlxPackageSpec,
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<ShadowBinResult> {
  const { force = false, ...shadowOptions } = options ?? {}

  const packageString = `${packageSpec.name}@${packageSpec.version}`

  // Use Socket's dlxPackage to install and execute.
  const result = await dlxPackage(args, {
    force,
    package: packageString,
    spawnOptions: shadowOptions,
  }, spawnExtra)

  return {
    spawnPromise: result.spawnPromise,
  }
}

/**
 * Helper to spawn coana with dlx.
 * Returns a CResult with stdout extraction for backward compatibility.
 *
 * If SOCKET_CLI_COANA_LOCAL_PATH environment variable is set, uses the local
 * Coana CLI at that path instead of downloading from npm.
 */
export async function spawnCoanaDlx(
  args: string[] | readonly string[],
  orgSlug?: string,
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<CResult<string>> {
  const {
    env: spawnEnv,
    ipc,
    ...dlxOptions
  } = {
    __proto__: null,
    ...options,
  } as DlxOptions

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
      const finalEnv = {
        ...process.env,
        ...mixinsEnv,
        ...spawnEnv,
      }
      const spawnResult = await spawn('node', [localCoanaPath, ...args], {
        cwd: dlxOptions.cwd,
        env: finalEnv,
        stdio: spawnExtra?.['stdio'] || 'inherit',
      })

      return {
        ok: true,
        data:
          typeof spawnResult.stdout === 'string'
            ? spawnResult.stdout
            : spawnResult.stdout.toString(),
      }
    }

    // Use dlx version.
    const result = await spawnDlx(
      {
        name: '@coana-tech/cli',
        version: `~${ENV.INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION}`,
      },
      args,
      {
        force: true,
        ...dlxOptions,
        env: {
          ...process.env,
          ...mixinsEnv,
          ...spawnEnv,
        },
        ipc: {
          [SOCKET_CLI_SHADOW_ACCEPT_RISKS]: true,
          [SOCKET_CLI_SHADOW_API_TOKEN]: SOCKET_PUBLIC_API_TOKEN,
          [SOCKET_CLI_SHADOW_SILENT]: true,
          ...ipc,
        },
      },
      spawnExtra,
    )
    const output = await result.spawnPromise
    return {
      ok: true,
      data:
        typeof output.stdout === 'string'
          ? output.stdout
          : output.stdout.toString(),
    }
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

/**
 * Helper to spawn cdxgen with dlx.
 */
export async function spawnCdxgenDlx(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<ShadowBinResult> {
  return await spawnDlx(
    {
      name: '@cyclonedx/cdxgen',
      version: `${ENV.INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION}`,
    },
    args,
    { force: false, ...options },
    spawnExtra,
  )
}

/**
 * Helper to spawn synp with dlx.
 */
export async function spawnSynpDlx(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<ShadowBinResult> {
  return await spawnDlx(
    {
      name: 'synp',
      version: `${ENV.INLINED_SOCKET_CLI_SYNP_VERSION}`,
    },
    args,
    { force: false, ...options },
    spawnExtra,
  )
}
