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
 * - Uses @socketsecurity/lib/dlx/package for direct package installation
 * - Installs packages to ~/.socket/_dlx directory
 * - Executes binaries directly without package manager commands
 */

import { dlxPackage } from '@socketsecurity/lib/dlx/package'

import { resolveCdxgen, resolveCoana, resolveSfw } from './resolve-binary.mjs'
import { getDefaultOrgSlug } from '../../commands/ci/fetch-default-org-slug.mjs'
import ENV from '../../constants/env.mts'
import { getErrorCause, InputError } from '../error/errors.mts'
import { getDefaultApiToken, getDefaultProxyUrl } from '../socket/sdk.mjs'
import { spawnNode } from '../spawn/spawn-node.mjs'

import type {
  ShadowBinOptions,
  ShadowBinResult,
} from '../../shadow/npm-base.mjs'
import type { CResult } from '../../types.mjs'
import type { SpawnExtra, SpawnResult } from '@socketsecurity/lib/spawn'

export type DlxOptions = ShadowBinOptions & {
  agent?: 'npm' | 'pnpm' | 'yarn' | undefined
  force?: boolean | undefined
  silent?: boolean | undefined
}

export type DlxPackageSpec = {
  binaryName?: string | undefined
  name: string
  version: string
}

/**
 * Validate package name to prevent command injection.
 * Package names must follow npm naming rules.
 */
function validatePackageName(name: string): void {
  // Basic validation: no shell metacharacters, must be valid npm package name.
  // npm package names can contain: lowercase letters, numbers, hyphens, underscores, dots, and @ for scopes.
  const validNamePattern =
    /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/

  if (!validNamePattern.test(name)) {
    throw new InputError(
      `Invalid package name "${name}". Package names must contain only lowercase letters, numbers, hyphens, underscores, dots, and optionally a scope (@org/package).`,
    )
  }

  // Check for path traversal attempts.
  if (name.includes('..') || (name.includes('/') && !name.startsWith('@'))) {
    throw new InputError(
      `Invalid package name "${name}". Package names cannot contain path traversal sequences.`,
    )
  }
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

  // Validate package name for security.
  validatePackageName(packageSpec.name)

  const packageString = `${packageSpec.name}@${packageSpec.version}`

  // Use Socket's dlxPackage to install and execute.
  const result = await dlxPackage(
    args,
    {
      package: packageString,
      binaryName: packageSpec.binaryName,
      force,
      spawnOptions: shadowOptions,
    },
    spawnExtra,
  )

  return {
    spawnPromise: result.spawnPromise as unknown as SpawnResult,
  }
}

/**
 * Helper to spawn Coana with dlx.
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
  const { env: spawnEnv, ...dlxOptions } = {
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
    const resolution = resolveCoana()

    // Use local Coana CLI if available.
    if (resolution.type === 'local') {
      const finalEnv = {
        ...process.env,
        ...mixinsEnv,
        ...spawnEnv,
      }
      const spawnPromise = spawnNode([resolution.path, ...args], {
        ...dlxOptions,
        env: finalEnv,
        stdio: spawnExtra?.['stdio'] || 'inherit',
      })

      return {
        ok: true,
        data: spawnPromise.process.stdout?.toString() ?? '',
      }
    }

    // Use dlx version.
    const result = await spawnDlx(
      resolution.details,
      args,
      {
        force: true,
        ...dlxOptions,
        env: {
          ...process.env,
          ...mixinsEnv,
          ...spawnEnv,
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
 * If SOCKET_CLI_CDXGEN_LOCAL_PATH environment variable is set, uses the local
 * cdxgen binary at that path instead of downloading from npm.
 */
export async function spawnCdxgenDlx(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<ShadowBinResult> {
  const resolution = resolveCdxgen()

  // Use local cdxgen if available.
  if (resolution.type === 'local') {
    const { env: spawnEnv, ...dlxOptions } = {
      __proto__: null,
      ...options,
    } as DlxOptions

    const spawnPromise = spawnNode([resolution.path, ...args], {
      ...dlxOptions,
      env: {
        ...process.env,
        ...spawnEnv,
      },
      stdio: spawnExtra?.['stdio'] || 'inherit',
    })

    return {
      spawnPromise,
    }
  }

  // Use dlx version.
  return await spawnDlx(
    resolution.details,
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

/**
 * Helper to spawn Socket Firewall (sfw) with dlx.
 * If SOCKET_CLI_SFW_LOCAL_PATH environment variable is set, uses the local
 * sfw binary at that path instead of downloading from npm.
 */
export async function spawnSfwDlx(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<ShadowBinResult> {
  const resolution = resolveSfw()

  // Use local sfw if available.
  if (resolution.type === 'local') {
    const { env: spawnEnv, ...dlxOptions } = {
      __proto__: null,
      ...options,
    } as DlxOptions

    const spawnPromise = spawnNode([resolution.path, ...args], {
      ...dlxOptions,
      env: {
        ...process.env,
        ...spawnEnv,
      },
      stdio: spawnExtra?.['stdio'] || 'inherit',
    })

    return {
      spawnPromise,
    }
  }

  // Use dlx version.
  return await spawnDlx(
    resolution.details,
    args,
    { force: false, ...options },
    spawnExtra,
  )
}
