/**
 * DLX execution utilities for Socket CLI.
 * Manages package execution via npx/pnpm dlx/yarn dlx commands.
 *
 * Key Functions:
 * - spawnCdxgenDlx: Execute CycloneDX generator via dlx
 * - spawnCoanaDlx: Execute Coana CLI tool via dlx
 * - spawnDlx: Execute packages using dlx-style commands
 * - spawnSynpDlx: Execute Synp converter via dlx
 *
 * Package Manager Detection:
 * - Auto-detects npm, pnpm, or yarn based on lockfiles
 * - Supports force-refresh and silent execution modes
 *
 * Integration:
 * - Works with shadow binaries for security scanning
 * - Handles version pinning and cache management
 * - Configures environment for third-party tools
 */

import { createRequire } from 'node:module'
import { NPM, PNPM, YARN } from '@socketsecurity/lib/constants/agents'
import { SOCKET_PUBLIC_API_TOKEN } from '@socketsecurity/lib/constants/socket'
import { getOwn } from '@socketsecurity/lib/objects'
import type { SpawnExtra } from '@socketsecurity/lib/spawn'
import { spawn } from '@socketsecurity/lib/spawn'
import { getDefaultOrgSlug } from '../../commands/ci/fetch-default-org-slug.mjs'
import { FLAG_QUIET, FLAG_SILENT } from '../../constants/cli.mts'
import ENV from '../../constants/env.mts'
import {
  PACKAGE_LOCK_JSON,
  PNPM_LOCK_YAML,
  YARN_LOCK,
} from '../../constants/packages.mts'
import {
  getShadowNpxBinPath,
  getShadowPnpmBinPath,
  getShadowYarnBinPath,
} from '../../constants/paths.mts'
import {
  SOCKET_CLI_SHADOW_ACCEPT_RISKS,
  SOCKET_CLI_SHADOW_API_TOKEN,
  SOCKET_CLI_SHADOW_SILENT,
} from '../../constants/shadow.mts'
import type {
  ShadowBinOptions,
  ShadowBinResult,
} from '../../shadow/npm-base.mjs'
import type { CResult } from '../../types.mjs'
import { getErrorCause } from '../error/errors.mts'
import { findUp } from '../fs/fs.mts'
import { getDefaultApiToken, getDefaultProxyUrl } from '../socket/sdk.mjs'
import { isYarnBerry } from '../yarn/version.mts'

const require = createRequire(import.meta.url)

export type DlxOptions = ShadowBinOptions & {
  force?: boolean | undefined
  agent?: 'npm' | 'pnpm' | 'yarn' | undefined
  silent?: boolean | undefined
}

export type DlxPackageSpec = {
  name: string
  version: string
}

/**
 * Regex to check if a version string contains range operators.
 * Matches any version with range operators: ~, ^, >, <, =, x, X, *, spaces, or ||.
 */
const rangeOperatorsRegExp = /[~^><=xX* ]|\|\|/

/**
 * Spawns a package using dlx-style execution (npx/pnpm dlx/yarn dlx).
 * Automatically detects the appropriate package manager if not specified.
 * Uses force/update flags to ensure the latest version within the range is fetched.
 */
export async function spawnDlx(
  packageSpec: DlxPackageSpec,
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<ShadowBinResult> {
  // If version is not pinned exactly, default to force and silent for better UX.
  const isNotPinned = rangeOperatorsRegExp.test(packageSpec.version)

  const {
    agent,
    force = false,
    silent = isNotPinned,
    ...shadowOptions
  } = options ?? {}

  let finalShadowOptions = shadowOptions

  let pm = agent

  // Auto-detect package manager if not specified.
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

  const packageString = `${packageSpec.name}@${packageSpec.version}`

  // Build command args based on package manager.
  let spawnArgs: string[]

  if (pm === PNPM) {
    spawnArgs = ['dlx']
    if (force) {
      // For pnpm, set dlx-cache-max-age to 0 via env to force fresh download.
      // This ensures we always get the latest version within the range.
      finalShadowOptions = {
        ...finalShadowOptions,
        env: {
          // @ts-expect-error - getOwn may return undefined, but spread handles it
          ...getOwn(finalShadowOptions, 'env'),
          // Set dlx cache max age to 0 minutes to bypass cache.
          // The npm_config_ prefix is how pnpm reads config from environment variables.
          // See: https://pnpm.io/npmrc#settings
          npm_config_dlx_cache_max_age: '0',
        },
      }
    }
    if (silent) {
      spawnArgs.push(FLAG_SILENT)
    }
    spawnArgs.push(packageString, ...args)

    const shadowPnpmBin = /*@__PURE__*/ require(getShadowPnpmBinPath())
    return await shadowPnpmBin(spawnArgs, finalShadowOptions, spawnExtra)
  }
  if (pm === YARN && isYarnBerry()) {
    spawnArgs = ['dlx']
    // Yarn dlx runs in a temporary environment by design and should always fetch fresh.
    if (silent) {
      spawnArgs.push(FLAG_QUIET)
    }
    spawnArgs.push(packageString, ...args)

    const shadowYarnBin = /*@__PURE__*/ require(getShadowYarnBinPath())
    return await shadowYarnBin(spawnArgs, finalShadowOptions, spawnExtra)
  }
  // Use npm exec/npx.
  // For consistency, we'll use npx which is more commonly used for one-off execution.
  spawnArgs = ['--yes']
  if (force) {
    // Use --force to bypass cache and get latest within range.
    spawnArgs.push('--force')
  }
  if (silent) {
    spawnArgs.push(FLAG_SILENT)
  }
  spawnArgs.push(packageString, ...args)

  const shadowNpxBin = /*@__PURE__*/ require(getShadowNpxBinPath())
  return await shadowNpxBin(spawnArgs, finalShadowOptions, spawnExtra)
}

/**
 * Helper to spawn coana with dlx.
 * Automatically uses force and silent when version is not pinned exactly.
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

    // Use npm/dlx version.
    const result = await spawnDlx(
      {
        name: '@coana-tech/cli',
        version: `~${ENV.INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION}`,
      },
      args,
      {
        force: true,
        silent: true,
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
    { force: false, silent: true, ...options },
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
    { force: false, silent: true, ...options },
    spawnExtra,
  )
}
