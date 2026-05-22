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

import { promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'
import { getOwn } from '@socketsecurity/registry/lib/objects'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import { getDefaultOrgSlug } from '../commands/ci/fetch-default-org-slug.mts'
import constants, {
  FLAG_QUIET,
  FLAG_SILENT,
  NPM,
  PNPM,
  YARN,
} from '../constants.mts'
import { getErrorCause } from './errors.mts'
import { findUp } from './fs.mts'
import { getDefaultApiToken, getDefaultProxyUrl } from './sdk.mts'
import { isYarnBerry } from './yarn-version.mts'

import type { ShadowBinOptions, ShadowBinResult } from '../shadow/npm-base.mts'
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
  let spawnArgs: string[]

  if (pm === PNPM) {
    spawnArgs = []
    // The --silent flag must come before dlx, not after.
    if (silent) {
      spawnArgs.push(FLAG_SILENT)
    }
    spawnArgs.push('dlx')
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
    if (force) {
      // Use --force to bypass cache and get latest within range.
      spawnArgs.push('--force')
    }
    if (silent) {
      spawnArgs.push(FLAG_SILENT)
    }
    spawnArgs.push(packageString, ...args)

    const shadowNpxBin = /*@__PURE__*/ require(constants.shadowNpxBinPath)
    return await shadowNpxBin(spawnArgs, finalShadowOptions, spawnExtra)
  }
}

export type CoanaDlxOptions = DlxOptions & {
  coanaVersion?: string | undefined
}

/**
 * Cache of resolved Coana CLI script paths from the npm-install fallback,
 * keyed by version string. Lives for the lifetime of the Socket CLI process so
 * repeated invocations (e.g. socket fix --pr looping per GHSA) only install
 * once.
 */
const installedCoanaScriptPathsByVersion = new Map<string, string>()

/**
 * Spawn an installed Coana entry point via `node` (or directly, if it's a
 * native binary). Shared by the SOCKET_CLI_COANA_LOCAL_PATH branch and the
 * npm-install fallback.
 */
async function spawnCoanaScriptViaNode(
  scriptPath: string,
  args: string[] | readonly string[],
  finalEnv: NodeJS.ProcessEnv,
  options: { cwd?: string | URL | undefined },
  spawnExtra?: SpawnExtra | undefined,
): Promise<CResult<string>> {
  const isBinary =
    !scriptPath.endsWith('.js') && !scriptPath.endsWith('.mjs')

  const spawnArgs = isBinary ? args : [scriptPath, ...args]
  const spawnResult = await spawn(
    isBinary ? scriptPath : 'node',
    spawnArgs,
    {
      cwd: options.cwd,
      env: finalEnv,
      stdio: spawnExtra?.['stdio'] || 'inherit',
    },
  )

  return { ok: true, data: spawnResult.stdout }
}

/**
 * Resolve the executable JS file inside an installed @coana-tech/cli package
 * by reading its package.json `bin` field. Returns an absolute path suitable
 * for passing to `node`.
 */
async function resolveCoanaBinFromInstallDir(
  installDir: string,
): Promise<string> {
  const packageJsonPath = path.join(
    installDir,
    'node_modules',
    '@coana-tech',
    'cli',
    'package.json',
  )
  const pkg = JSON.parse(await fs.readFile(packageJsonPath, 'utf8')) as {
    bin?: string | Record<string, string> | undefined
  }
  const { bin } = pkg
  let relativeBin: string | undefined
  if (typeof bin === 'string') {
    relativeBin = bin
  } else if (bin && typeof bin === 'object') {
    // Prefer an entry named "coana" if present; otherwise take the first.
    relativeBin = bin['coana'] ?? Object.values(bin)[0]
  }
  if (!relativeBin) {
    throw new Error(
      `@coana-tech/cli package.json at ${packageJsonPath} is missing a usable bin entry`,
    )
  }
  return path.resolve(path.dirname(packageJsonPath), relativeBin)
}

/**
 * Install @coana-tech/cli into a fresh temp directory via `npm install` and
 * return its executable JS path. Caches the result per version for the
 * lifetime of the process.
 */
async function installCoanaToTmpdir(
  version: string,
  finalEnv: NodeJS.ProcessEnv,
): Promise<string> {
  const cached = installedCoanaScriptPathsByVersion.get(version)
  if (cached) {
    return cached
  }
  const installDir = await fs.mkdtemp(path.join(os.tmpdir(), 'socket-coana-'))
  await spawn(
    'npm',
    [
      'install',
      '--no-save',
      '--no-package-lock',
      '--no-audit',
      '--no-fund',
      '--prefix',
      installDir,
      `@coana-tech/cli@${version}`,
    ],
    {
      env: finalEnv,
      stdio: 'inherit',
    },
  )
  const scriptPath = await resolveCoanaBinFromInstallDir(installDir)
  installedCoanaScriptPathsByVersion.set(version, scriptPath)
  return scriptPath
}

/**
 * Fallback path used when the dlx (npx / pnpm dlx / yarn dlx) invocation
 * fails. Installs @coana-tech/cli into a temp directory via `npm install`
 * and spawns it directly via `node`.
 */
async function spawnCoanaViaNpmInstall(
  args: string[] | readonly string[],
  version: string,
  finalEnv: NodeJS.ProcessEnv,
  options: { cwd?: string | URL | undefined },
  spawnExtra?: SpawnExtra | undefined,
): Promise<CResult<string>> {
  let scriptPath: string
  try {
    scriptPath = await installCoanaToTmpdir(version, finalEnv)
  } catch (e) {
    const stderr = (e as any)?.stderr
    const cause = getErrorCause(e)
    return {
      ok: false,
      data: e,
      message: `npm install fallback failed: ${stderr || cause}`,
    }
  }
  return await spawnCoanaScriptViaNode(
    scriptPath,
    args,
    finalEnv,
    options,
    spawnExtra,
  )
}

/**
 * Helper to spawn coana with dlx.
 * Automatically uses force and silent when version is not pinned exactly.
 * Returns a CResult with stdout extraction for backward compatibility.
 *
 * If SOCKET_CLI_COANA_LOCAL_PATH environment variable is set, uses the local
 * Coana CLI at that path instead of downloading from npm.
 *
 * If the dlx path fails (e.g. broken `npx` on the host), falls back to
 * `npm install`-ing @coana-tech/cli into a temp directory and invoking it
 * directly via `node`. The fallback can be disabled with
 * SOCKET_CLI_COANA_DISABLE_NPM_FALLBACK or forced as the primary path with
 * SOCKET_CLI_COANA_FORCE_NPM_INSTALL.
 */
export async function spawnCoanaDlx(
  args: string[] | readonly string[],
  orgSlug?: string,
  options?: CoanaDlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<CResult<string>> {
  const {
    coanaVersion,
    env: spawnEnv,
    ipc,
    ...dlxOptions
  } = {
    __proto__: null,
    ...options,
  } as CoanaDlxOptions

  const mixinsEnv: Record<string, string> = {
    SOCKET_CLI_VERSION: constants.ENV.INLINED_SOCKET_CLI_VERSION,
    // Forwarded to the Coana CLI so it can append our product token to its
    // outbound axios User-Agent header. Format mirrors Coana's base UA:
    // `socket/<version> node/<nodeVersion> <platform>/<arch>`.
    SOCKET_CALLER_USER_AGENT: `socket/${constants.ENV.INLINED_SOCKET_CLI_VERSION} node/${process.version} ${process.platform}/${process.arch}`,
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

  const finalEnv = {
    ...process.env,
    ...constants.processEnv,
    ...mixinsEnv,
    ...spawnEnv,
  }

  const resolvedVersion =
    coanaVersion || constants.ENV.INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION

  const localCoanaPath = process.env['SOCKET_CLI_COANA_LOCAL_PATH']
  // Use local Coana CLI if path is provided.
  if (localCoanaPath) {
    try {
      return await spawnCoanaScriptViaNode(
        localCoanaPath,
        args,
        finalEnv,
        { cwd: dlxOptions.cwd },
        spawnExtra,
      )
    } catch (e) {
      return buildDlxErrorResult(e)
    }
  }

  // Allow forcing the npm-install path for debugging or for environments
  // where dlx is known-broken.
  if (process.env['SOCKET_CLI_COANA_FORCE_NPM_INSTALL']) {
    return await spawnCoanaViaNpmInstall(
      args,
      resolvedVersion,
      finalEnv,
      { cwd: dlxOptions.cwd },
      spawnExtra,
    )
  }

  try {
    // Use npm/dlx version.
    const result = await spawnDlx(
      {
        name: '@coana-tech/cli',
        version: resolvedVersion,
      },
      args,
      {
        force: true,
        silent: true,
        ...dlxOptions,
        env: finalEnv,
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
    const dlxError = buildDlxErrorResult(e)

    if (process.env['SOCKET_CLI_COANA_DISABLE_NPM_FALLBACK']) {
      return dlxError
    }

    logger.warn(
      'Coana dlx invocation failed; falling back to `npm install` + `node`.',
    )

    const fallbackResult = await spawnCoanaViaNpmInstall(
      args,
      resolvedVersion,
      finalEnv,
      { cwd: dlxOptions.cwd },
      spawnExtra,
    )
    if (fallbackResult.ok) {
      return fallbackResult
    }
    // Surface both errors so support has full context.
    return {
      ok: false,
      data: e,
      message: `${dlxError.message}. npm-install fallback also failed: ${fallbackResult.message}`,
    }
  }
}

/**
 * Build a CResult error from a thrown spawn error, preserving exit code,
 * signal, and stderr context.
 */
function buildDlxErrorResult(e: unknown): CResult<string> {
  const stderr = (e as any)?.stderr
  const exitCode = (e as any)?.code
  const signal = (e as any)?.signal
  const cause = getErrorCause(e)
  const details: string[] = []
  if (typeof exitCode === 'number') {
    details.push(`exit code ${exitCode}`)
  }
  if (signal) {
    details.push(`signal ${signal}`)
  }
  const detailSuffix = details.length ? ` (${details.join(', ')})` : ''
  const message = stderr
    ? `Coana command failed${detailSuffix}: ${stderr}`
    : `Coana command failed${detailSuffix}: ${cause}`
  return {
    ok: false,
    data: e,
    message,
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
