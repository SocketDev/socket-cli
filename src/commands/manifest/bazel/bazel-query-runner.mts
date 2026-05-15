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
    'show_repo',
    '--all_visible_repos',
    '--output=streamed_jsonproto',
    ...userFlags,
  ]
}

function buildBazelArgv(queryStr: string, opts: BazelQueryOptions): string[] {
  // Startup flags MUST precede the `query` subcommand.
  // Bazel argv shape: <startup> query <queryFlags> <invocationFlags> <queryStr> --output=build <userFlags>
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
    '--output=build',
    ...userFlags,
  ]
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numericExitCode(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
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
): Promise<BazelQueryResult> {
  const argv = buildBazelArgv(queryStr, opts)
  if (opts.verbose) {
    logger.log('[VERBOSE] Executing:', opts.bin, ', args:', argv)
  }
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
  }
}

/**
 * Bzlmod-native visible repository enumeration. This is only a candidate
 * source; callers must still validate each returned apparent repo name with a
 * semantic query for generated JVM Maven rules.
 */
export async function runBazelModShowVisibleRepos(
  opts: BazelQueryOptions,
): Promise<BazelQueryResult> {
  const argv = buildBazelModShowVisibleReposArgv(opts)
  if (opts.verbose) {
    logger.log('[VERBOSE] Executing:', opts.bin, ', args:', argv)
  }
  try {
    const output = await spawn(opts.bin, argv, {
      cwd: opts.cwd,
      timeout: BAZEL_QUERY_TIMEOUT_MS,
      ...(opts.env ? { env: opts.env } : {}),
    })
    const { code, stderr, stdout } = output
    return { code, stdout, stderr }
  } catch (e) {
    return normalizeSpawnError(e)
  }
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
