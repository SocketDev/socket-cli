import { createRequire } from 'node:module'

import { getOwn } from '@socketsecurity/registry/lib/objects'

import constants, { NPM, PNPM, YARN } from '../constants.mts'
import { findUp } from './fs.mts'
import { isYarnBerry } from './yarn-version.mts'
import shadowBin from '../shadow/npm/bin.mts'

import type { ShadowBinOptions, ShadowBinResult } from '../shadow/npm/bin.mts'
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
    force = false,
    agent,
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
      spawnArgs.push('--silent')
    }
    spawnArgs.push(packageString, ...args)

    const shadowPnpmBin = /*@__PURE__*/ require(constants.shadowPnpmBinPath)
    return await shadowPnpmBin(spawnArgs, finalShadowOptions, spawnExtra)
  } else if (pm === YARN && isYarnBerry()) {
    binName = YARN
    spawnArgs = ['dlx']
    // Yarn dlx runs in a temporary environment by design and should always fetch fresh.
    if (silent) {
      spawnArgs.push('--quiet')
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
      spawnArgs.push('--silent')
    }
    spawnArgs.push(packageString, ...args)

    return await shadowBin(
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
 */
export async function spawnCoanaDlx(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<ShadowBinResult> {
  return await spawnDlx(
    {
      name: '@coana-tech/cli',
      version: `~${constants.ENV.INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION}`,
    },
    args,
    { force: true, silent: true, ...options },
    spawnExtra,
  )
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
