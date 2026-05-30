import { logger } from '@socketsecurity/registry/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../../constants.mts'

import type { RepoProbe } from './bazel-repo-discovery.mts'

export type BazelQueryOptions = {
  bin: string
  cwd: string
  invocationFlags: string[]
  bazelRc?: string
  bazelFlags?: string
  bazelOutputBase?: string
  // Per-invocation `--output_user_root` for server isolation. When set, all
  // argv builders inject it as a startup flag so a timed-out Bazel server
  // can be reaped via `bazel --output_user_root=<this> shutdown` + `rm -rf`
  // without disturbing the user's shared output_user_root. The Maven
  // orchestrator mkdtemp's a fresh path per invocation; the legacy PyPI
  // path may leave it unset for now.
  outputUserRoot?: string
  env?: NodeJS.ProcessEnv
  verbose?: boolean
}

export type BazelQueryResult = {
  stdout: string
  stderr: string
  code: number
}

// Default per-invocation timeout for bazel queries. Bazel cold-cache starts
// can take several minutes; 10 minutes is generous while still bounding CI hangs.
const BAZEL_QUERY_TIMEOUT_MS = 600_000
const STDERR_TAIL_BYTES = 4_096
const STDOUT_EXCERPT_BYTES = 1_024

// Splits the user-supplied --bazel-flags string on whitespace.
// Empty / undefined returns []. No shell parsing — quoted args with embedded
// whitespace are not supported (documented limitation; same trust model as
// gradleOpts).
export function splitBazelFlags(flags: string | undefined): string[] {
  if (!flags) {
    return []
  }
  return flags.split(/\s+/).filter(Boolean)
}

// Build the shared startup-flag prefix for any bazel invocation. Centralised
// so `--output_user_root` propagates to every spawn — principle 7 of the
// Maven design requires per-invocation server isolation across query,
// cquery, and `bazel mod` commands alike.
function buildStartupFlags(opts: BazelQueryOptions): string[] {
  const startup: string[] = []
  if (opts.bazelRc) {
    startup.push(`--bazelrc=${opts.bazelRc}`)
  }
  if (opts.outputUserRoot) {
    startup.push(`--output_user_root=${opts.outputUserRoot}`)
  }
  if (opts.bazelOutputBase) {
    startup.push(`--output_base=${opts.bazelOutputBase}`)
  }
  return startup
}

function buildBazelModShowVisibleReposArgv(opts: BazelQueryOptions): string[] {
  const userFlags = splitBazelFlags(opts.bazelFlags)
  return [
    ...buildStartupFlags(opts),
    'mod',
    'dump_repo_mapping',
    '',
    '--output=json',
    ...userFlags,
  ]
}

function buildBazelModShowMavenExtensionArgv(
  opts: BazelQueryOptions,
): string[] {
  const userFlags = splitBazelFlags(opts.bazelFlags)
  return [
    ...buildStartupFlags(opts),
    'mod',
    'show_extension',
    '@rules_jvm_external//:extensions.bzl%maven',
    ...userFlags,
  ]
}

function buildBazelModShowPipExtensionArgv(opts: BazelQueryOptions): string[] {
  const userFlags = splitBazelFlags(opts.bazelFlags)
  return [
    ...buildStartupFlags(opts),
    'mod',
    'show_extension',
    '@rules_python//python/extensions:pip.bzl%pip',
    '--extension_usages=<root>',
    ...userFlags,
  ]
}

function buildBazelArgv(
  queryStr: string,
  opts: BazelQueryOptions,
  output = 'build',
): string[] {
  // Startup flags MUST precede the `query` subcommand.
  // Bazel argv shape: <startup> query <queryFlags> <invocationFlags> <queryStr> --output=<output> <userFlags>
  // Keep query output stable and avoid updating Bazel lockfiles while extracting.
  const queryFlags = ['--lockfile_mode=off', '--noshow_progress']
  const userFlags = splitBazelFlags(opts.bazelFlags)
  return [
    ...buildStartupFlags(opts),
    'query',
    ...queryFlags,
    ...opts.invocationFlags,
    queryStr,
    `--output=${output}`,
    ...userFlags,
  ]
}

// Lightweight presence-check cquery used by the tri-state probe classifier.
// `--keep_going --output=label` keeps it fast even on partial-analysis
// repos and avoids paying for `--output=jsonproto` plus
// `--proto:output_rule_attrs` (which the heavier metadata extraction in
// `bazel-cquery.mts` needs but the probe does not).
function buildBazelProbeCqueryArgv(
  repoName: string,
  opts: BazelQueryOptions,
): string[] {
  const userFlags = splitBazelFlags(opts.bazelFlags)
  return [
    ...buildStartupFlags(opts),
    'cquery',
    '--lockfile_mode=off',
    '--noshow_progress',
    ...opts.invocationFlags,
    `@${repoName}//...`,
    '--output=label',
    '--keep_going',
    ...userFlags,
  ]
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numericExitCode(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function excerpt(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) {
    return value
  }
  return value.slice(0, maxBytes) + '\n[truncated]'
}

function logBazelTrace({
  argv,
  durationMs,
  opts,
  result,
  step,
}: {
  argv: string[]
  durationMs: number
  opts: BazelQueryOptions
  result: BazelQueryResult
  step: string
}): void {
  if (!opts.verbose) {
    return
  }
  const stderrBytes = byteLength(result.stderr)
  const stdoutBytes = byteLength(result.stdout)
  const category = result.code === 0 ? 'ok' : 'bazel-query-failed'
  logger.log('[VERBOSE] bazel subprocess trace:', `category=${category}`, {
    argv,
    category,
    code: result.code,
    cwd: opts.cwd,
    durationMs,
    stderrBytes,
    stdoutBytes,
    step,
    timedOut: false,
    timeoutMs: BAZEL_QUERY_TIMEOUT_MS,
  })
  if (result.code !== 0 && result.stderr) {
    logger.log(
      '[VERBOSE] bazel stderr tail:',
      excerpt(result.stderr.slice(-STDERR_TAIL_BYTES), STDERR_TAIL_BYTES),
    )
  } else if (result.stdout && stdoutBytes <= STDOUT_EXCERPT_BYTES) {
    logger.log('[VERBOSE] bazel stdout excerpt:', result.stdout)
  }
}

function normalizeSpawnError(error: unknown): BazelQueryResult {
  const e = error as {
    code?: unknown
    status?: unknown
    stderr?: unknown
    stdout?: unknown
  }
  return {
    code: numericExitCode(e?.code) ?? numericExitCode(e?.status) ?? -1,
    stderr: stringField(e?.stderr),
    stdout: stringField(e?.stdout),
  }
}

/**
 * Run `bazel query` with the standardized argv shape and capture
 * stdout/stderr/code. Wraps the call in a spinner that resolves on success
 * and fails on non-zero exit. Rejected spawn calls are normalized into a
 * BazelQueryResult so retry/skip handling can inspect stderr.
 */
export async function runBazelQuery(
  queryStr: string,
  opts: BazelQueryOptions,
  output?: string,
): Promise<BazelQueryResult> {
  const argv = buildBazelArgv(queryStr, opts, output)
  if (opts.verbose) {
    logger.log('[VERBOSE] Executing:', opts.bin, ', args:', argv)
  }
  const startedAt = Date.now()
  const { spinner } = constants
  let result: BazelQueryResult | undefined
  try {
    spinner.start(`Running bazel query (${queryStr.slice(0, 80)})...`)
    const output = await spawn(opts.bin, argv, {
      cwd: opts.cwd,
      timeout: BAZEL_QUERY_TIMEOUT_MS,
      ...(opts.env ? { env: opts.env } : {}),
    })
    const { code, stderr, stdout } = output
    result = { code, stdout, stderr }
    return result
  } catch (e) {
    result = normalizeSpawnError(e)
    return result
  } finally {
    const truncated = queryStr.slice(0, 80)
    if (result?.code === 0) {
      spinner.successAndStop(`bazel query completed (${truncated}).`)
    } else {
      spinner.failAndStop(`bazel query failed (${truncated}).`)
    }
    if (result) {
      logBazelTrace({
        argv,
        durationMs: Date.now() - startedAt,
        opts,
        result,
        step: `bazel query ${truncated}`,
      })
    }
  }
}

async function runBazelOneShot(
  argv: string[],
  opts: BazelQueryOptions,
  step: string,
): Promise<BazelQueryResult> {
  if (opts.verbose) {
    logger.log('[VERBOSE] Executing:', opts.bin, ', args:', argv)
  }
  const startedAt = Date.now()
  let result: BazelQueryResult
  try {
    const output = await spawn(opts.bin, argv, {
      cwd: opts.cwd,
      timeout: BAZEL_QUERY_TIMEOUT_MS,
      ...(opts.env ? { env: opts.env } : {}),
    })
    const { code, stderr, stdout } = output
    result = { code, stdout, stderr }
  } catch (e) {
    result = normalizeSpawnError(e)
  }
  logBazelTrace({
    argv,
    durationMs: Date.now() - startedAt,
    opts,
    result,
    step,
  })
  return result
}

/**
 * Bzlmod-native visible repository enumeration. NOTE: only consumed by the
 * legacy PyPI path; the Maven path uses `runBazelModShowMavenExtension`
 * instead because `dump_repo_mapping` over-enumerates apparent names that
 * are not Maven hubs.
 */
export async function runBazelModShowVisibleRepos(
  opts: BazelQueryOptions,
): Promise<BazelQueryResult> {
  return await runBazelOneShot(
    buildBazelModShowVisibleReposArgv(opts),
    opts,
    'bazel mod dump_repo_mapping',
  )
}

/**
 * Bzlmod-native Maven hub enumeration via the rules_jvm_external maven
 * extension. The text-format report lists every repo the extension
 * generated; `parseShowExtensionOutput` (bazel-repo-discovery.mts)
 * extracts the hubs from the `Fetched repositories:` section.
 */
export async function runBazelModShowMavenExtension(
  opts: BazelQueryOptions,
): Promise<BazelQueryResult> {
  return await runBazelOneShot(
    buildBazelModShowMavenExtensionArgv(opts),
    opts,
    'bazel mod show_extension rules_jvm_external maven',
  )
}

/**
 * Bzlmod-native rules_python pip extension usage inspection. Used by the
 * PyPI path; kept here since the argv shape is identical to the maven
 * variant modulo the extension target.
 */
export async function runBazelModShowPipExtension(
  opts: BazelQueryOptions,
): Promise<BazelQueryResult> {
  return await runBazelOneShot(
    buildBazelModShowPipExtensionArgv(opts),
    opts,
    'bazel mod show_extension rules_python pip',
  )
}

/**
 * Build a `RepoProbe` (compatible with bazel-repo-discovery's tri-state
 * classifier) bound to opts. Runs the lightweight presence-check cquery
 * `@<name>//... --output=label --keep_going` — cheap enough to attempt
 * every conventional Maven hub name without triggering `repository_rule`
 * fetches on undefined names (Exp 3).
 */
export function buildMavenProbeFor(opts: BazelQueryOptions): RepoProbe {
  return async (repoName: string) => {
    const argv = buildBazelProbeCqueryArgv(repoName, opts)
    const result = await runBazelOneShot(
      argv,
      opts,
      `bazel cquery probe @${repoName}`,
    )
    return { code: result.code, stdout: result.stdout, stderr: result.stderr }
  }
}

/**
 * Build a `RepoProbe` for validating pip hub candidates.
 * Queries the hub for package targets (e.g. `@<hub>//...`) and returns the
 * full result triple so the caller can check for `:pkg` labels or alias
 * rules. Does NOT require `pypi_name=` tags in the hub output, because
 * those tags live on spoke repos, not the hub alias layer.
 */
export function buildPypiProbeFor(opts: BazelQueryOptions): RepoProbe {
  return async (hubName: string) => {
    const queryStr = `@${hubName}//...`
    const result = await runBazelQuery(queryStr, opts)
    return { code: result.code, stdout: result.stdout, stderr: result.stderr }
  }
}

// Re-exported for direct test access — useful when asserting on argv shape
// without spawning. Returns the exact argv `runBazelModShowMavenExtension`
// would pass to spawn.
export const _internalArgvBuilders = {
  buildBazelArgv,
  buildBazelModShowMavenExtensionArgv,
  buildBazelModShowPipExtensionArgv,
  buildBazelModShowVisibleReposArgv,
  buildBazelProbeCqueryArgv,
  buildStartupFlags,
}
