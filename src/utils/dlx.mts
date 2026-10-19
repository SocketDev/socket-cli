/**
 * DLX execution utilities for Socket CLI.
 * Manages package execution via npx/pnpm dlx/yarn dlx commands.
 *
 * Key Functions:
 * - spawnCdxgenDlx: Execute CycloneDX generator via dlx
 * - spawnDlx: Execute packages using dlx-style commands
 * - spawnSynpDlx: Execute Synp converter via dlx
 *
 * Package Manager Detection:
 * - Auto-detects npm, pnpm, or yarn based on lockfiles
 * - Supports silent execution mode
 *
 * Integration:
 * - Works with shadow binaries for security scanning
 * - Handles version pinning and cache management
 * - Configures environment for third-party tools
 */

import { createRequire } from 'node:module'

import { getOwn } from '@socketsecurity/registry/lib/objects'

import constants, {
  FLAG_QUIET,
  FLAG_SILENT,
  NPM,
  PNPM,
  YARN,
} from '../constants.mts'
import { findUp } from './fs.mts'
import { isYarnBerry } from './yarn-version.mts'

import type { ShadowBinOptions, ShadowBinResult } from '../shadow/npm-base.mts'
import type { SpawnExtra } from '@socketsecurity/registry/lib/spawn'

const require = createRequire(import.meta.url)

const { PACKAGE_LOCK_JSON, PNPM_LOCK_YAML, YARN_LOCK } = constants

export type DlxOptions = ShadowBinOptions & {
  agent?: 'npm' | 'pnpm' | 'yarn' | undefined
  silent?: boolean | undefined
}

export type DlxPackageSpec = {
  name: string
  version: string
}

/**
 * Spawns a package using dlx-style execution (npx/pnpm dlx/yarn dlx).
 * Automatically detects the appropriate package manager if not specified.
 */
export async function spawnDlx(
  packageSpec: DlxPackageSpec,
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<ShadowBinResult> {
  const { agent, silent = false, ...shadowOptions } = options ?? {}

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
    spawnArgs = []
    // The --silent flag must come before dlx, not after.
    if (silent) {
      spawnArgs.push(FLAG_SILENT)
    }
    spawnArgs.push('dlx')
    // Never let the target project's `.pnpmfile.cjs` hooks run while we launch
    // a third-party tool via `pnpm dlx`. In a pnpm workspace root, `pnpm dlx`
    // loads the cwd's `.pnpmfile.cjs`, so a broken hook there (e.g. a `require`
    // of an unresolved Git LFS pointer) crashes the launcher with a bare exit
    // code before our tool ever starts. The dlx tool installs into an isolated
    // store, so the project's install hooks are irrelevant to it. pnpm honors
    // this only as a config setting, not as a `dlx` CLI flag, so it must be set
    // via the npm_config_ env var. See: https://pnpm.io/npmrc#settings
    finalShadowOptions = {
      ...finalShadowOptions,
      env: {
        ...getOwn(finalShadowOptions, 'env'),
        npm_config_ignore_pnpmfile: 'true',
      },
    }
    spawnArgs.push(packageString, ...args)

    const shadowPnpmBin = /*@__PURE__*/ require(constants.shadowPnpmBinPath)
    return await shadowPnpmBin(spawnArgs, finalShadowOptions, spawnExtra)
  } else if (pm === YARN && isYarnBerry()) {
    spawnArgs = ['dlx']
    // Yarn dlx runs in a temporary environment by design and should always fetch fresh.
    if (silent) {
      spawnArgs.push(FLAG_QUIET)
    }
    spawnArgs.push(packageString, ...args)

    // Use node-modules linker instead of PnP to avoid issues with packages
    // that have undeclared dependencies (e.g. @coana-tech/cli -> @babel/types).
    finalShadowOptions = {
      ...finalShadowOptions,
      env: {
        ...getOwn(finalShadowOptions, 'env'),
        YARN_NODE_LINKER: 'node-modules',
      },
    }

    const shadowYarnBin = /*@__PURE__*/ require(constants.shadowYarnBinPath)
    return await shadowYarnBin(spawnArgs, finalShadowOptions, spawnExtra)
  } else {
    // Use npm exec/npx.
    // For consistency, we'll use npx which is more commonly used for one-off execution.
    spawnArgs = ['--yes']
    if (silent) {
      spawnArgs.push(FLAG_SILENT)
    }
    spawnArgs.push(packageString, ...args)

    const shadowNpxBin = /*@__PURE__*/ require(constants.shadowNpxBinPath)
    return await shadowNpxBin(spawnArgs, finalShadowOptions, spawnExtra)
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
      version: constants.ENV.INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION,
    },
    args,
    { silent: true, ...options },
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
    { silent: true, ...options },
    spawnExtra,
  )
}
