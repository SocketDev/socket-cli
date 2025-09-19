import { createRequire } from 'node:module'

import { getOwn } from '@socketsecurity/registry/lib/objects'

import { getDefaultOrgSlug } from '../commands/ci/fetch-default-org-slug.mts'
import constants, {
  FLAG_QUIET,
  FLAG_SILENT,
  NPM,
  PNPM,
  UNKNOWN_ERROR,
  YARN,
} from '../constants.mts'
import { findUp } from './fs.mts'
import { getDefaultApiToken, getDefaultProxyUrl } from './sdk.mts'
import { isYarnBerry } from './yarn-version.mts'
import shadowNpmBin from '../shadow/npm/bin.mts'

import type { ShadowBinOptions, ShadowBinResult } from '../shadow/npm/bin.mts'
import type { CResult } from '../types.mts'
import type { SpawnExtra } from '@socketsecurity/registry/lib/spawn'

const require = createRequire(import.meta.url)

const { PACKAGE_LOCK_JSON, PNPM_LOCK_YAML, YARN_LOCK } = constants

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
  let binName: string
  let spawnArgs: string[]

  if (pm === PNPM) {
    binName = PNPM
    spawnArgs = ['dlx']
    if (force) {
      // For pnpm, set dlx-cache-max-age to 0 via env to force fresh download.
      // This ensures we always get the latest version within the range.
      finalShadowOptions = {
        ...finalShadowOptions,
        env: {
          ...getOwn(finalShadowOptions, 'env'),
          // Set dlx cache max age to 0 minutes to bypass cache.
          // The npm_config_ prefix is how pnpm reads config from environment variables.
          // See: https://pnpm.io/npmrc#settings
          npm_config_dlx_cache_max_age: '0',
        },
      }
      // Add --ignore-scripts for extra security.
      // While pnpm dlx allows the executed package's scripts by default,
      // we disable them since coana/cdxgen/synp don't need postinstall scripts.
      spawnArgs.push('--ignore-scripts')
    }
    if (silent) {
      spawnArgs.push(FLAG_SILENT)
    }
    spawnArgs.push(packageString, ...args)

    const shadowPnpmBin = /*@__PURE__*/ require(constants.shadowPnpmBinPath)
    return await shadowPnpmBin(spawnArgs, finalShadowOptions, spawnExtra)
  } else if (pm === YARN && isYarnBerry()) {
    binName = YARN
    spawnArgs = ['dlx']
    // Yarn dlx runs in a temporary environment by design and should always fetch fresh.
    if (silent) {
      spawnArgs.push(FLAG_QUIET)
    }
    spawnArgs.push(packageString, ...args)

    const shadowYarnBin = /*@__PURE__*/ require(constants.shadowYarnBinPath)
    return await shadowYarnBin(spawnArgs, finalShadowOptions, spawnExtra)
  } else {
    // Use npm exec/npx.
    // For consistency, we'll use npx which is more commonly used for one-off execution.
    binName = 'npx'
    spawnArgs = ['--yes']
    if (force) {
      // Use --force to bypass cache and get latest within range.
      spawnArgs.push('--force')
    }
    if (silent) {
      spawnArgs.push(FLAG_SILENT)
    }
    spawnArgs.push(packageString, ...args)

    return await shadowNpmBin(
      binName as 'npm' | 'npx',
      spawnArgs,
      finalShadowOptions,
      spawnExtra,
    )
  }
}

/**
 * Helper to spawn coana with dlx.
 * Automatically uses force and silent when version is not pinned exactly.
 * Returns a CResult with stdout extraction for backward compatibility.
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
    SOCKET_CLI_VERSION: constants.ENV.INLINED_SOCKET_CLI_VERSION,
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
    const result = await spawnDlx(
      {
        name: '@coana-tech/cli',
        version: `~${constants.ENV.INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION}`,
      },
      args,
      {
        force: true,
        silent: true,
        ...dlxOptions,
        env: {
          ...process.env,
          ...constants.processEnv,
          ...mixinsEnv,
          ...spawnEnv,
        },
        ipc: {
          [constants.SOCKET_CLI_SHADOW_ACCEPT_RISKS]: true,
          [constants.SOCKET_CLI_SHADOW_API_TOKEN]:
            constants.SOCKET_PUBLIC_API_TOKEN,
          [constants.SOCKET_CLI_SHADOW_SILENT]: true,
          ...ipc,
        },
      },
      spawnExtra,
    )
    const output = await result.spawnPromise
    return { ok: true, data: output.stdout }
  } catch (e) {
    const stderr = (e as any)?.stderr
    const cause = (e as Error)?.message || UNKNOWN_ERROR
    const message = stderr ? stderr : cause
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
      version: `${constants.ENV.INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION}`,
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
      version: `${constants.ENV.INLINED_SOCKET_CLI_SYNP_VERSION}`,
    },
    args,
    { force: false, silent: true, ...options },
    spawnExtra,
  )
}
