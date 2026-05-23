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

function buildBazelModShowVisibleReposArgv(opts: BazelQueryOptions): string[] {
  const startup: string[] = []
  if (opts.bazelRc) {
    startup.push(`--bazelrc=${opts.bazelRc}`)
  }
  if (opts.bazelOutputBase) {
    startup.push(`--output_base=${opts.bazelOutputBase}`)
  }
  const userFlags = splitBazelFlags(opts.bazelFlags)
  return [
    ...startup,
    'mod',
    'dump_repo_mapping',
    '',
    '--output=json',
    ...userFlags,
  ]
}

function buildBazelModShowPipExtensionArgv(opts: BazelQueryOptions): string[] {
  const startup: string[] = []
  if (opts.bazelRc) {
    startup.push(`--bazelrc=${opts.bazelRc}`)
  }
  if (opts.bazelOutputBase) {
    startup.push(`--output_base=${opts.bazelOutputBase}`)
  }
  const userFlags = splitBazelFlags(opts.bazelFlags)
  return [
    ...startup,
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
  const startup: string[] = []
  if (opts.bazelRc) {
    startup.push(`--bazelrc=${opts.bazelRc}`)
  }
  if (opts.bazelOutputBase) {
    startup.push(`--output_base=${opts.bazelOutputBase}`)
  }
  // Keep query output stable and avoid updating Bazel lockfiles while extracting.
  const queryFlags = ['--lockfile_mode=off', '--noshow_progress']
  const userFlags = splitBazelFlags(opts.bazelFlags)
  return [
    ...startup,
    'query',
    ...queryFlags,
    ...opts.invocationFlags,
    queryStr,
    `--output=${output}`,
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

/**
 * Bzlmod-native visible repository enumeration. This is only a candidate
 * source; callers must still validate each returned apparent repo name with a
 * semantic query for generated ecosystem rules.
 */
export async function runBazelModShowVisibleRepos(
  opts: BazelQueryOptions,
): Promise<BazelQueryResult> {
  const argv = buildBazelModShowVisibleReposArgv(opts)
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
    step: 'bazel mod dump_repo_mapping',
  })
  return result
}

/**
 * Bzlmod-native rules_python pip extension usage inspection. This is the
 * authoritative source for root-module pip.parse metadata when Bazel supports
 * the command; callers keep bounded static parsing as fallback.
 */
export async function runBazelModShowPipExtension(
  opts: BazelQueryOptions,
): Promise<BazelQueryResult> {
  const argv = buildBazelModShowPipExtensionArgv(opts)
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
    step: 'bazel mod show_extension rules_python pip',
  })
  return result
}

/**
 * Build a `RepoProbe` (compatible with bazel-repo-discovery) bound to opts.
 * Used by `discoverMavenRepos` to validate candidate Maven repo
 * names against the running workspace.
 */
export function buildProbeFor(opts: BazelQueryOptions): RepoProbe {
  return async (repoName: string) => {
    const queryStr = `kind("jvm_import rule|aar_import rule", @${repoName}//:*)`
    const result = await runBazelQuery(queryStr, opts)
    return { stdout: result.stdout, code: result.code }
  }
}

/**
 * Build a `RepoProbe` for validating pip hub candidates.
 * Queries the hub for package targets (e.g. `@<hub>//...`) and returns
 * stdout so the caller can check for `:pkg` labels or alias rules.
 * Does NOT require `pypi_name=` tags in the hub output, because those
 * tags live on spoke repos, not the hub alias layer.
 */
export function buildPypiProbeFor(opts: BazelQueryOptions): RepoProbe {
  return async (hubName: string) => {
    const queryStr = `@${hubName}//...`
    const result = await runBazelQuery(queryStr, opts)
    return { stdout: result.stdout, code: result.code }
  }
}
