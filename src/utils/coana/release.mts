/**
 * Coana CLI releases for Socket CLI.
 * Runs the Coana CLI from the cache that Coana and the Socket CLIs share, and
 * downloads it from the Socket API when the cache lacks it. "Launching Coana"
 * in coana-package-manager's packages/cli/docs/gcs-releases.md specifies the
 * steps.
 *
 * Key Functions:
 * - spawnCoana: Run the Coana CLI for a version spec
 *
 * Cache:
 * - Only the vendored coana-cache.mjs reads or writes it
 */

import { createHash } from 'node:crypto'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import semver from 'semver'
import { x as extractTar } from 'tar'

import { getDefaultOrgSlug } from '../../commands/ci/fetch-default-org-slug.mts'
import constants, {
  COANA_CLI_VERSION,
  ERROR_UNABLE_RESOLVE_ORG,
  SOCKET_CLI_API_TOKEN_VARIABLES,
} from '../../constants.mts'
import {
  COANA_CACHE_FILENAME,
  coanaCacheDistPath,
  coanaCliWrapperPath,
} from '../../paths/coana.mts'
import {
  cleanupBundledTool,
  getBundledTool,
  isSea,
  runEmbeddedJsTool,
} from '../../sea/runtime.mts'
import { apiFetch, sendApiRequest } from '../api.mts'
import { debugDir, debugFn } from '../debug.mts'
import { errorMessage } from '../errors.mts'
import { withTmpDir } from '../fs.mts'
import { logger } from '../logger.mts'
import {
  getCliUserAgent,
  getDefaultApiBaseUrl,
  getDefaultProxyUrl,
  resolveDefaultApiToken,
} from '../sdk.mts'
import { spawn } from '../spawn.mts'

import type { CResult } from '../../types.mts'
import type { SpawnOptions } from '../spawn.mts'
import type { Spinner } from '../spinner.mts'

type CoanaArtifacts = {
  cli: CoanaComponent
  version: string
}

type CoanaCacheResult = {
  exitCode: number
  stderr: string
  stdout: string
}

type CoanaComponent = {
  sha256: string
  size: number
  url: string
}

type CoanaDownload = { ok: true } | { ok: false; status: number }

type CoanaSpawnOptions = {
  coanaVersion?: string | undefined
  cwd?: string | URL | undefined
  env?: Record<string, string | undefined> | undefined
  // The oldest Coana the command exists in; checked against the version a
  // pinned spec resolves to.
  minimumVersion?: string | undefined
  repoName?: string | undefined
  spinner?: Spinner | undefined
  stdio?: SpawnOptions['stdio'] | undefined
}

const CACHE_NOT_WRITABLE_EXIT_CODE = 3
const COMPONENT = 'cli'
const NOT_CACHED_EXIT_CODE = 4
const SHA256_REGEXP = /^[0-9a-f]{64}$/
const TOKEN_VARIABLES: ReadonlySet<string> = new Set([
  ...SOCKET_CLI_API_TOKEN_VARIABLES,
  'SOCKET_CLI_CONFIG',
])

function cacheResultToCResult(result: CoanaCacheResult): CResult<string> {
  if (result.exitCode === 0) {
    return { ok: true, data: result.stdout }
  }
  return {
    ok: false,
    message:
      result.exitCode === CACHE_NOT_WRITABLE_EXIT_CODE
        ? 'Cannot write to the Coana cache'
        : 'The Coana cache failed',
    cause:
      result.stderr || `${COANA_CACHE_FILENAME} exited with ${result.exitCode}`,
  }
}

/**
 * The user's `env` for Coana, without:
 * - the `npm_package_*` variables that npm, pnpm and yarn classic set for each
 *   leaf of the cwd's package.json. Coana doesn't read them, and in a large
 *   monorepo they can push argv and env past ARG_MAX, so that the spawn fails
 *   with E2BIG.
 * - the variables socket-cli reads the API token from, and SOCKET_CLI_CONFIG,
 *   which can carry one. Coana gets the token from socket-cli, and would pass
 *   them on to the tools it runs.
 *
 * The registry's `spawn` spreads `process.env` under the env it is given, so
 * they are set to `undefined`, which Node drops.
 */
function coanaUserEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const key of Object.keys(env)) {
    out[key] =
      key.toLowerCase().startsWith('npm_package_') ||
      TOKEN_VARIABLES.has(key.toUpperCase())
        ? undefined
        : env[key]
  }
  return out
}

/**
 * Build a CResult error from a thrown spawn error, preserving exit code,
 * signal, and stderr context.
 */
function coanaSpawnErrorResult(e: unknown): CResult<string> {
  const stderr = (e as any)?.stderr
  const stdout = (e as any)?.stdout
  const exitCode = (e as any)?.code
  const signal = (e as any)?.signal
  const details: string[] = []
  if (typeof exitCode === 'number') {
    details.push(`exit code ${exitCode}`)
  }
  if (signal) {
    details.push(`signal ${signal}`)
  }
  const detailSuffix = details.length ? ` (${details.join(', ')})` : ''
  // Coana logs some failures, e.g. unresolved Gradle dependencies, to stdout.
  const detail = stderr || stdout || errorMessage(e)
  const message =
    typeof exitCode === 'string'
      ? `Failed to launch Coana${detailSuffix}: ${detail}`
      : `Coana command failed${detailSuffix}: ${detail}`
  return {
    ok: false,
    data: e,
    message,
  }
}

/**
 * Stream `component`'s tarball into `destDir`, checking its size and sha256 on
 * the way. The tarball holds only regular files, so anything else is dropped.
 */
async function downloadComponent(
  component: CoanaComponent,
  destDir: string,
): Promise<CoanaDownload> {
  const response = await apiFetch(component.url, {
    headers: { 'User-Agent': getCliUserAgent() },
  })
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    debugFn('error', `Coana CLI download failed with ${response.status}`)
    return { ok: false, status: response.status }
  }
  const hash = createHash('sha256')
  let received = 0
  await pipeline(
    Readable.from(response.body),
    new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length
        if (received > component.size) {
          callback(
            new Error(
              `The Coana CLI tarball is larger than the expected ${component.size} bytes`,
            ),
          )
          return
        }
        hash.update(chunk)
        callback(null, chunk)
      },
    }),
    extractTar({
      cwd: destDir,
      filter: (_path, entry) =>
        'type' in entry &&
        (entry.type === 'Directory' || entry.type === 'File'),
      // Run as root, tar would otherwise give the shared cache the archive's
      // owners.
      preserveOwner: false,
      strict: true,
    }),
  )
  const sha256 = hash.digest('hex')
  if (received !== component.size || sha256 !== component.sha256) {
    throw new Error(
      `The Coana CLI tarball does not match its checksum (expected ${component.size} bytes with sha256 ${component.sha256}, got ${received} bytes with sha256 ${sha256})`,
    )
  }
  return { ok: true }
}

type CoanaCliDir = { dir: string; version: string }

/**
 * The directory of the Coana CLI's `cli` component for `versionSpec`, an exact
 * version or a range, and the version it holds, downloading it into the cache
 * when the cache lacks it. `env` reaches the cache script, which reads
 * `XDG_CACHE_HOME` from it.
 */
async function getCoanaCliDir(
  versionSpec: string,
  org: CResult<string>,
  env: NodeJS.ProcessEnv,
  spinner: Spinner | undefined,
): Promise<CResult<CoanaCliDir>> {
  try {
    const exactVersion = semver.valid(versionSpec)
    if (exactVersion) {
      const cached = await lookup(exactVersion)
      if (cached) {
        return cached
      }
    }
    if (!org.ok) {
      // getDefaultOrgSlug puts some explanations in `data`.
      const detail =
        org.cause ?? (typeof org.data === 'string' ? org.data : undefined)
      return {
        ok: false,
        message: ERROR_UNABLE_RESOLVE_ORG,
        cause: `Downloading the Coana CLI ${versionSpec} needs one: ${org.message}${detail ? ` (${detail})` : ''}`,
      }
    }
    const orgSlug = org.data
    const artifacts = await requestArtifacts(
      exactVersion ?? versionSpec,
      orgSlug,
    )
    if (!artifacts.ok) {
      return artifacts
    }
    if (artifacts.data.version !== exactVersion) {
      const cached = await lookup(artifacts.data.version)
      if (cached) {
        return cached
      }
    }
    const downloading = `Downloading the Coana CLI ${artifacts.data.version}...`
    const spinning = spinner?.isSpinning ? spinner : undefined
    const previousText = spinning?.text
    if (spinning) {
      spinning.setText(downloading)
    } else {
      logger.info(downloading)
    }
    try {
      return withVersion(
        await installComponent(artifacts.data, orgSlug, env),
        artifacts.data.version,
      )
    } finally {
      spinning?.setText(previousText)
    }
  } catch (e) {
    return {
      ok: false,
      message: `Failed to get the Coana CLI ${versionSpec}`,
      cause: errorMessage(e),
    }
  }

  /** The cached directory or a failure; `undefined` when the cache lacks it. */
  async function lookup(
    version: string,
  ): Promise<CResult<CoanaCliDir> | undefined> {
    const result = await runCoanaCache(['lookup', version, COMPONENT], env)
    return result.exitCode === NOT_CACHED_EXIT_CODE
      ? undefined
      : withVersion(cacheResultToCResult(result), version)
  }
}

async function installComponent(
  artifacts: CoanaArtifacts,
  orgSlug: string,
  env: NodeJS.ProcessEnv,
): Promise<CResult<string>> {
  return await withTmpDir('socket-coana-cli-', async extractDir => {
    let current = artifacts
    let download = await downloadComponent(current.cli, extractDir)
    // A 4xx means the signed URL expired or was otherwise refused.
    if (!download.ok && download.status >= 400 && download.status < 500) {
      // Pin the new request to the resolved version, which a range is not.
      const renewed = await requestArtifacts(current.version, orgSlug)
      if (!renewed.ok) {
        return renewed
      }
      current = renewed.data
      download = await downloadComponent(current.cli, extractDir)
    }
    if (!download.ok) {
      return {
        ok: false,
        message: `Failed to download the Coana CLI ${current.version}`,
        cause: `The download host responded with status ${download.status}.`,
      }
    }
    return cacheResultToCResult(
      await runCoanaCache(
        ['install', current.version, COMPONENT, current.cli.sha256, extractDir],
        env,
      ),
    )
  })
}

function parseCoanaArtifacts(value: unknown): CoanaArtifacts | undefined {
  const { components, version } = (value ?? {}) as {
    components?: unknown
    version?: unknown
  }
  const { sha256, size, url } = ((components as any)?.[COMPONENT] ?? {}) as {
    sha256?: unknown
    size?: unknown
    url?: unknown
  }
  if (
    typeof version !== 'string' ||
    !semver.valid(version) ||
    typeof sha256 !== 'string' ||
    !SHA256_REGEXP.test(sha256) ||
    typeof size !== 'number' ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    typeof url !== 'string' ||
    // apiFetch speaks only https.
    !url.startsWith('https://') ||
    !URL.canParse(url)
  ) {
    return undefined
  }
  return { cli: { sha256, size, url }, version }
}

async function requestArtifacts(
  versionSpec: string,
  orgSlug: string,
): Promise<CResult<CoanaArtifacts>> {
  const result = await sendApiRequest<unknown>(
    `orgs/${encodeURIComponent(orgSlug)}/coana-cli/artifacts`,
    {
      body: { components: [COMPONENT], version: versionSpec },
      method: 'POST',
    },
  )
  if (!result.ok) {
    return result
  }
  const artifacts = parseCoanaArtifacts(result.data)
  if (!artifacts) {
    debugDir('inspect', { body: result.data })
    return {
      ok: false,
      message: 'Socket API error',
      cause: `Unexpected response to a request for the Coana CLI ${versionSpec}`,
    }
  }
  return { ok: true, data: artifacts }
}

/**
 * Run the vendored cache script, which prints only a directory to stdout.
 * Throws only when Node itself cannot be spawned.
 */
async function runCoanaCache(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<CoanaCacheResult> {
  if (isSea()) {
    const result = await runEmbeddedJsTool('coana-cache', args, {
      env,
      stdio: 'pipe',
    })
    return {
      exitCode: result.code ?? 1,
      stderr: result.stderr?.trim() ?? '',
      stdout: result.stdout?.trim() ?? '',
    }
  }
  try {
    const result = await spawn(
      constants.execPath,
      [coanaCacheDistPath(constants.distPath), ...args],
      { env, stdio: 'pipe' },
    )
    return {
      exitCode: 0,
      stderr: String(result.stderr).trim(),
      stdout: String(result.stdout).trim(),
    }
  } catch (e) {
    const exitCode = (e as any)?.code
    if (typeof exitCode !== 'number') {
      throw e
    }
    return {
      exitCode,
      stderr: String((e as any)?.stderr ?? '').trim(),
      stdout: String((e as any)?.stdout ?? '').trim(),
    }
  }
}

function withVersion(
  dir: CResult<string>,
  version: string,
): CResult<CoanaCliDir> {
  return dir.ok ? { ok: true, data: { dir: dir.data, version } } : dir
}

/**
 * Run the Coana CLI, downloading it into the cache that Coana and the Socket
 * CLIs share when the cache lacks the version. Returns a CResult with Coana's
 * stdout.
 *
 * Coana runs in the user's environment, less what coanaUserEnv leaves out, plus
 * the variables socket-cli sets for it. Coana passes its environment on to the
 * build tools it runs, after removing the variables it reads.
 *
 * If SOCKET_CLI_COANA_LOCAL_PATH environment variable is set, uses the local
 * Coana CLI at that path instead.
 */
export async function spawnCoana(
  args: string[] | readonly string[],
  orgSlug?: string,
  options?: CoanaSpawnOptions | undefined,
): Promise<CResult<string>> {
  const {
    coanaVersion,
    cwd,
    env: spawnEnv,
    minimumVersion,
    repoName,
    spinner,
    stdio = 'inherit',
  } = {
    __proto__: null,
    ...options,
  } as CoanaSpawnOptions

  const localPath = process.env['SOCKET_CLI_COANA_LOCAL_PATH']
  const runningInSea = isSea()
  let apiToken: string | undefined
  try {
    apiToken = await resolveDefaultApiToken()
  } catch (error) {
    return {
      ok: false,
      message: 'Socket authentication failed',
      cause: error instanceof Error ? error.message : String(error),
    }
  }
  const org: CResult<string> = orgSlug
    ? { ok: true, data: orgSlug }
    : await getDefaultOrgSlug()
  const socketCliVariables: Record<string, string | undefined> = {
    SOCKET_CALLER_USER_AGENT: getCliUserAgent(),
    SOCKET_CLI_API_BASE_URL: getDefaultApiBaseUrl(),
    SOCKET_CLI_API_PROXY: getDefaultProxyUrl(),
    SOCKET_CLI_API_TOKEN: apiToken,
    SOCKET_CLI_VERSION: constants.ENV.INLINED_SOCKET_CLI_VERSION,
    SOCKET_ORG_SLUG: org.ok ? org.data : undefined,
    // The default name would mix the cached configuration of unrelated
    // projects.
    SOCKET_REPO_NAME:
      repoName && repoName !== constants.SOCKET_DEFAULT_REPOSITORY
        ? repoName
        : undefined,
  }
  const userEnv = coanaUserEnv(process.env)
  const env = { ...userEnv }
  for (const { 0: name, 1: value } of Object.entries(socketCliVariables)) {
    // Unset ones leave the user's own, except SOCKET_CLI_API_TOKEN, which
    // coanaUserEnv removed: with no token from socket-cli, Coana gets none.
    if (value !== undefined) {
      env[name] = value
    }
  }
  for (const { 0: name, 1: value } of Object.entries(
    coanaUserEnv(spawnEnv ?? {}),
  )) {
    if (!TOKEN_VARIABLES.has(name.toUpperCase())) {
      env[name] = value
    }
  }

  let scriptPath = localPath
  if (!scriptPath) {
    const coanaDir = await getCoanaCliDir(
      coanaVersion || COANA_CLI_VERSION,
      org,
      userEnv,
      spinner,
    )
    if (!coanaDir.ok) {
      return coanaDir
    }
    const { dir, version } = coanaDir.data
    if (minimumVersion && semver.lt(version, minimumVersion)) {
      return {
        ok: false,
        message: `Coana ${version} is too old for this command`,
        cause: `It needs Coana ${minimumVersion} or newer. Pin that or a newer version with --reach-version or --fix-version, or leave the version unpinned.`,
      }
    }
    scriptPath = coanaCliWrapperPath(dir)
  }

  // A local path may name a native binary.
  const isBinary = !scriptPath.endsWith('.js') && !scriptPath.endsWith('.mjs')
  let nodePath: string | undefined
  try {
    const executable = isBinary
      ? scriptPath
      : runningInSea
        ? (nodePath = await getBundledTool('node'))
        : constants.execPath
    const spawnResult = await spawn(
      executable,
      isBinary ? args : [scriptPath, ...args],
      { cwd, env, spinner, stdio },
    )
    return { ok: true, data: String(spawnResult.stdout) }
  } catch (e) {
    return coanaSpawnErrorResult(e)
  } finally {
    if (nodePath) {
      await cleanupBundledTool(nodePath)
    }
  }
}
