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
import type {
  SpawnExtra,
  SpawnOptions,
} from '@socketsecurity/registry/lib/spawn'

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
    // Never let the target project's `.pnpmfile.cjs` hooks run while we launch
    // a third-party tool via `pnpm dlx`. In a pnpm workspace root, `pnpm dlx`
    // loads the cwd's `.pnpmfile.cjs`, so a broken hook there (e.g. a `require`
    // of an unresolved Git LFS pointer) crashes the launcher with a bare exit
    // code before our tool ever starts. The dlx tool installs into an isolated
    // store, so the project's install hooks are irrelevant to it. pnpm honors
    // this only as a config setting, not as a `dlx` CLI flag, so it must be set
    // via the npm_config_ env var. See: https://pnpm.io/npmrc#settings
    const pnpmEnv: Record<string, string | undefined> = {
      ...getOwn(finalShadowOptions, 'env'),
      npm_config_ignore_pnpmfile: 'true',
    }
    if (force) {
      // Set dlx-cache-max-age to 0 minutes to bypass cache and force a fresh
      // download. This ensures we always get the latest version within the range.
      pnpmEnv['npm_config_dlx_cache_max_age'] = '0'
    }
    finalShadowOptions = {
      ...finalShadowOptions,
      env: pnpmEnv,
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
 * Strip npm-injected `npm_package_*` env vars before spawning a Coana
 * subprocess. npm (and pnpm/yarn classic) populate one env var per leaf in
 * the cwd's package.json — `npm_package_dependencies_*`, `npm_package_scripts_*`,
 * etc. In big monorepos with hundreds of deps this can easily account for
 * 50KB+ of environment, pushing combined argv + env past Linux ARG_MAX
 * (~128KB) and causing `spawn` to fail with E2BIG before Coana even starts.
 *
 * Coana does not read `npm_package_*` itself, so dropping them is safe. We
 * intentionally keep `npm_config_*` (registry, cache, proxy settings sourced
 * from .npmrc), `npm_lifecycle_*`, and everything else untouched — those can
 * matter for outbound network behavior of nested `npm install` calls.
 */
function sanitizeEnvForCoanaSubprocess(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const key of Object.keys(env)) {
    if (key.startsWith('npm_package_')) {
      continue
    }
    out[key] = env[key]
  }
  return out
}

/**
 * Spawn an installed Coana entry point via `node` (or directly, if it's a
 * native binary). Shared by the SOCKET_CLI_COANA_LOCAL_PATH branch and the
 * npm-install fallback.
 */
async function spawnCoanaScriptViaNode(
  scriptPath: string,
  args: string[] | readonly string[],
  finalEnv: NodeJS.ProcessEnv,
  options: {
    cwd?: string | URL | undefined
    stdio?: SpawnOptions['stdio'] | undefined
  },
  spawnExtra?: SpawnExtra | undefined,
): Promise<CResult<string>> {
  const isBinary = !scriptPath.endsWith('.js') && !scriptPath.endsWith('.mjs')

  const spawnArgs = isBinary ? args : [scriptPath, ...args]
  const spawnResult = await spawn(isBinary ? scriptPath : 'node', spawnArgs, {
    cwd: options.cwd,
    env: sanitizeEnvForCoanaSubprocess(finalEnv),
    stdio: options.stdio ?? spawnExtra?.['stdio'] ?? 'inherit',
  })

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
      env: sanitizeEnvForCoanaSubprocess(finalEnv),
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
  options: {
    cwd?: string | URL | undefined
    stdio?: SpawnOptions['stdio'] | undefined
  },
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
  try {
    return await spawnCoanaScriptViaNode(
      scriptPath,
      args,
      finalEnv,
      options,
      spawnExtra,
    )
  } catch (e) {
    return buildDlxErrorResult(e)
  }
}

type CoanaLauncherMode = 'auto' | 'npm-install' | 'npx'

/**
 * Resolve how the Coana engine should be launched.
 *
 * SOCKET_CLI_COANA_LAUNCHER wins when set:
 * - 'auto' (default): try dlx first, fall back to `npm install` + `node` on
 *   launcher-level failures.
 * - 'npm-install': skip dlx entirely; always `npm install` + `node`.
 * - 'npx': dlx only; never fall back.
 * Unrecognized values warn and behave as 'auto'.
 *
 * The legacy boolean variables SOCKET_CLI_COANA_FORCE_NPM_INSTALL
 * ('npm-install') and SOCKET_CLI_COANA_DISABLE_NPM_FALLBACK ('npx') are still
 * honored when the new variable is unset, but are intentionally undocumented.
 */
function getCoanaLauncherMode(): CoanaLauncherMode {
  const rawMode = process.env['SOCKET_CLI_COANA_LAUNCHER']
  const mode = rawMode?.trim().toLowerCase()
  if (mode) {
    if (mode === 'auto' || mode === 'npm-install' || mode === 'npx') {
      return mode
    }
    logger.warn(
      `Ignoring unrecognized SOCKET_CLI_COANA_LAUNCHER value "${rawMode}"; expected "auto", "npm-install", or "npx".`,
    )
    return 'auto'
  }
  if (process.env['SOCKET_CLI_COANA_FORCE_NPM_INSTALL']) {
    return 'npm-install'
  }
  if (process.env['SOCKET_CLI_COANA_DISABLE_NPM_FALLBACK']) {
    return 'npx'
  }
  return 'auto'
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
 * directly via `node`. The launcher strategy can be overridden with
 * SOCKET_CLI_COANA_LAUNCHER: 'auto' (the default) tries dlx with the
 * npm-install fallback, 'npm-install' skips dlx entirely, and 'npx' never
 * falls back.
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

  // `shadowNpmBase` (the dlx launcher) configures the child's stdio from its
  // `options` arg, NOT from the registry-spawn `extra` arg — the latter only
  // attaches metadata to the result. Callers that requested streaming via
  // `spawnExtra` (the 4th arg), e.g. `{ stdio: 'inherit' }` from
  // `socket manifest gradle`, were therefore silently ignored on this path:
  // Coana ran piped and its output — including the real failure reason — never
  // reached the user, leaving only an unhelpful "command failed". Resolve the
  // requested stdio from either argument and honor it on every launch path:
  // dlx, local-path, and npm-install (e.g. `socket fix --silence` requests
  // `stdio: 'pipe'` via options).
  const requestedStdio = spawnExtra?.['stdio'] ?? getOwn(dlxOptions, 'stdio')

  const localCoanaPath = process.env['SOCKET_CLI_COANA_LOCAL_PATH']
  // Use local Coana CLI if path is provided.
  if (localCoanaPath) {
    try {
      return await spawnCoanaScriptViaNode(
        localCoanaPath,
        args,
        finalEnv,
        { cwd: dlxOptions.cwd, stdio: requestedStdio },
        spawnExtra,
      )
    } catch (e) {
      return buildDlxErrorResult(e)
    }
  }

  const launcherMode = getCoanaLauncherMode()

  // Allow forcing the npm-install path for debugging or for environments
  // where dlx is known-broken.
  if (launcherMode === 'npm-install') {
    return await spawnCoanaViaNpmInstall(
      args,
      resolvedVersion,
      finalEnv,
      { cwd: dlxOptions.cwd, stdio: requestedStdio },
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
        // Do NOT silence the launcher. `--silent` (npm loglevel silent) hides
        // npm's own download/registry/launch errors, so when npx/pnpm-dlx fails
        // to fetch @coana-tech/cli the user is left with a bare exit code and no
        // cause. shadowNpmBase defaults to `--loglevel error`, which keeps real
        // launcher errors visible while staying quiet on success.
        silent: false,
        ...dlxOptions,
        ...(requestedStdio === undefined ? {} : { stdio: requestedStdio }),
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

    if (launcherMode === 'npx') {
      return dlxError
    }

    // Only retry via `npm install` when the failure looks like the launcher
    // never got Coana running. A real Coana process that booted and exited
    // with an error would just hit the same failure on retry.
    if (!shouldFallbackOnDlxError(e)) {
      return dlxError
    }

    logger.warn(
      'Coana dlx invocation failed; retrying via `npm install` + `node`.',
    )

    const fallbackResult = await spawnCoanaViaNpmInstall(
      args,
      resolvedVersion,
      finalEnv,
      { cwd: dlxOptions.cwd, stdio: requestedStdio },
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
 * Decide whether a thrown dlx error should trigger the npm-install fallback.
 *
 * The goal is to retry only when the dlx launcher (npx / pnpm dlx / yarn dlx)
 * failed before Coana itself ran. If Coana actually booted, any subsequent
 * non-zero exit is a real Coana failure and retrying would hit the same one.
 *
 * Signals we use, in priority order:
 * 1. Captured stderr containing Coana's startup banner — definitive proof
 *    Coana ran, so do NOT retry. Only available when the caller passed
 *    `stdio: 'pipe'` (or the spawn defaulted to it).
 * 2. Spawn-level errors (`e.code` is a string like 'ENOENT'): the binary
 *    wasn't found / couldn't start — retry.
 * 3. Signal kills (`e.signal` set, or numeric `e.code >= 128`): conventionally
 *    not a clean exit; the customer-observed exit code 249 falls here. Retry.
 * 4. Small integer exit codes with no banner in captured stderr: ambiguous,
 *    but Coana's own exit codes are small integers, so default to NOT retrying
 *    rather than blindly re-running Coana.
 */
function shouldFallbackOnDlxError(e: unknown): boolean {
  // Coana clearly ran (its banner is in the captured stderr) → any later
  // non-zero exit is a real Coana failure and retrying would hit it again.
  if (coanaBannerSeen(e)) {
    return false
  }
  return dlxLauncherFailedBeforeCoana(e)
}

/**
 * Heuristic: did the dlx launcher (npx / pnpm dlx / yarn dlx) fail BEFORE the
 * Coana process itself started? True for spawn-level errors (a string `code`
 * like ENOENT), signal kills, and exit codes >= 128 (conventionally
 * signal-derived) — all cases where the launcher, not Coana, is the culprit
 * (e.g. npx missing from PATH, or @coana-tech/cli failing to download). A small
 * integer exit code is deliberately NOT treated as a launch failure: Coana's
 * own exit codes are small integers too, so it is genuinely ambiguous.
 *
 * Caveat: a launcher that fails to download the package can also exit with a
 * small integer (npm/npx often exit 1), which lands in the ambiguous bucket.
 * We cannot disambiguate those from a real Coana exit without inspecting the
 * launcher's output, so the npm-install fallback does not fire for them.
 */
function dlxLauncherFailedBeforeCoana(e: unknown): boolean {
  const code = (e as any)?.code
  // Spawn-level failure (e.g. ENOENT when npx is missing from PATH).
  if (typeof code === 'string') {
    return true
  }
  // Killed by signal — almost never a clean Coana exit.
  if ((e as any)?.signal) {
    return true
  }
  // Exit codes >= 128 are conventionally signal-derived, and the observed
  // npx-launcher failures in the wild fall into this range (e.g. 249, 254).
  return typeof code === 'number' && code >= 128
}

/**
 * Definitive proof Coana actually booted: its startup banner appears in the
 * captured stderr. Only available when the launcher's output was piped
 * (captured); with inherited stdio there is nothing to inspect, so this
 * returns false (the failure is then classified by exit code / signal alone).
 */
function coanaBannerSeen(e: unknown): boolean {
  const capturedStderr = String((e as any)?.stderr ?? '')
  return !!capturedStderr && /Coana CLI version/i.test(capturedStderr)
}

/**
 * Build a CResult error from a thrown spawn error, preserving exit code,
 * signal, and stderr context.
 */
function buildDlxErrorResult(e: unknown): CResult<string> {
  const stderr = (e as any)?.stderr
  const stdout = (e as any)?.stdout
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
  // Prefer captured stderr, then stdout, then the generic spawn error. Coana
  // logs some failures (e.g. unresolved Gradle dependencies) to stdout, so
  // without the stdout fallback a piped failure collapsed to an unhelpful
  // "command failed" even when the real reason was captured.
  const detail = stderr || stdout || cause
  // Be honest about WHERE the failure happened. On the dlx path the spawned
  // process is the package-manager launcher (npx / pnpm dlx / yarn dlx), which
  // downloads @coana-tech/cli and only then runs it — so a failure may be the
  // launcher dying before Coana ever started, not Coana itself. We can only be
  // CERTAIN of that for a spawn-level error (a string `code` like ENOENT: the
  // launcher binary could not start, so Coana provably never ran). A non-zero
  // exit or signal is genuinely ambiguous — Coana may have started, streamed
  // output, and then died (e.g. OOM), or the launcher may have failed to fetch
  // the package — and with inherited stdio there is no captured output to tell
  // them apart, so we must not assert either way.
  let message: string
  if (coanaBannerSeen(e)) {
    message = `Coana command failed${detailSuffix}: ${detail}`
  } else if (typeof (e as any)?.code === 'string') {
    message = `Failed to launch Coana via the package manager${detailSuffix} — the npx/pnpm-dlx/yarn-dlx launcher could not start (e.g. it is missing from PATH): ${detail}`
  } else {
    message = `Coana failed to run via the package manager${detailSuffix}: ${detail}`
  }
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
