import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { getDefaultSpinner } from '@socketsecurity/lib-stable/spinner/default'

import type { RepoProbe } from './bazel-repo-discovery.mts'

const logger = getDefaultLogger()

export type BazelQueryOptions = {
  bin: string
  cwd: string
  invocationFlags: string[]
  bazelRc?: string | undefined
  bazelFlags?: string | undefined
  bazelOutputBase?: string | undefined
  // Per-invocation `--output_user_root` for server isolation. When set, all
  // argv builders inject it as a startup flag so a timed-out Bazel server
  // can be reaped via `bazel --output_user_root=<this> shutdown` + `rm -rf`
  // without disturbing the user's shared output_user_root. The Maven
  // orchestrator mkdtemp's a fresh path per invocation; the legacy PyPI
  // path may leave it unset for now.
  outputUserRoot?: string | undefined
  env?: NodeJS.ProcessEnv | undefined
  verbose?: boolean | undefined
}

export type BazelQueryResult = {
  stdout: string
  stderr: string
  code: number
}

// Default per-invocation timeout for bazel queries. Bazel cold-cache starts
// can take several minutes; 10 minutes is generous while still bounding CI hangs.
const BAZEL_QUERY_TIMEOUT_MS = 600_000
const STDERR_TAIL_BYTES = 4096
const STDOUT_EXCERPT_BYTES = 1024

export function buildBazelArgv(
  queryStr: string,
  config: BazelQueryOptions,
  output = 'build',
): string[] {
  // Startup flags MUST precede the `query` subcommand.
  // Bazel argv shape: <startup> query <queryFlags> <invocationFlags> <queryStr> --output=<output> <userFlags>
  // Keep query output stable and avoid updating Bazel lockfiles while extracting.
  const cfg = { __proto__: null, ...config } as typeof config
  const queryFlags = ['--lockfile_mode=off', '--noshow_progress']
  const userFlags = splitBazelFlags(cfg.bazelFlags)
  return [
    ...buildStartupFlags(config),
    'query',
    ...queryFlags,
    ...cfg.invocationFlags,
    queryStr,
    `--output=${output}`,
    ...userFlags,
  ]
}

export function buildBazelModShowMavenExtensionArgv(
  config: BazelQueryOptions,
): string[] {
  const cfg = { __proto__: null, ...config } as typeof config
  const userFlags = splitBazelFlags(cfg.bazelFlags)
  return [
    ...buildStartupFlags(config),
    'mod',
    'show_extension',
    '@rules_jvm_external//:extensions.bzl%maven',
    // A read-only scan must never rewrite the user's MODULE.bazel.lock; pin
    // the lockfile read-only before user flags, mirroring the query/cquery
    // argv builders.
    '--lockfile_mode=off',
    // Belt-and-suspenders output reducer mirroring the PyPI path: bias the
    // report toward the root module's usages. The authoritative pruning is
    // the importers-filter applied to the parsed output, so this is not
    // relied on for correctness.
    '--extension_usages=<root>',
    ...userFlags,
  ]
}

export function buildBazelModShowPipExtensionArgv(
  config: BazelQueryOptions,
): string[] {
  const cfg = { __proto__: null, ...config } as typeof config
  const userFlags = splitBazelFlags(cfg.bazelFlags)
  return [
    ...buildStartupFlags(config),
    'mod',
    'show_extension',
    '@rules_python//python/extensions:pip.bzl%pip',
    // A read-only scan must never rewrite the user's MODULE.bazel.lock; pin
    // the lockfile read-only before user flags, mirroring the query/cquery
    // argv builders.
    '--lockfile_mode=off',
    '--extension_usages=<root>',
    ...userFlags,
  ]
}

export function buildBazelModShowVisibleReposArgv(
  config: BazelQueryOptions,
): string[] {
  const cfg = { __proto__: null, ...config } as typeof config
  const userFlags = splitBazelFlags(cfg.bazelFlags)
  return [
    ...buildStartupFlags(config),
    'mod',
    'dump_repo_mapping',
    '',
    '--output=json',
    ...userFlags,
  ]
}

// Lightweight presence-check cquery used by the tri-state probe classifier.
// `--keep_going --output=label` keeps it fast even on partial-analysis
// repos and avoids paying for `--output=jsonproto` plus
// `--proto:output_rule_attrs` (which the heavier metadata extraction in
// `bazel-cquery.mts` needs but the probe does not).
export function buildBazelProbeCqueryArgv(
  repoName: string,
  config: BazelQueryOptions,
): string[] {
  const cfg = { __proto__: null, ...config } as typeof config
  const userFlags = splitBazelFlags(cfg.bazelFlags)
  return [
    ...buildStartupFlags(config),
    'cquery',
    '--lockfile_mode=off',
    '--noshow_progress',
    ...cfg.invocationFlags,
    `@${repoName}//...`,
    '--output=label',
    '--keep_going',
    ...userFlags,
  ]
}

/**
 * Build a `RepoProbe` (compatible with bazel-repo-discovery's tri-state
 * classifier) bound to the given query options. Runs the lightweight
 * presence-check cquery `@<name>//... --output=label --keep_going` — cheap
 * enough to attempt every conventional Maven hub name without triggering
 * `repository_rule` fetches on undefined names.
 */
export function buildMavenProbeFor(config: BazelQueryOptions): RepoProbe {
  return async (repoName: string) => {
    const argv = buildBazelProbeCqueryArgv(repoName, config)
    const result = await runBazelOneShot(
      argv,
      config,
      `bazel cquery probe @${repoName}`,
    )
    return { code: result.code, stderr: result.stderr, stdout: result.stdout }
  }
}

/**
 * Build a `RepoProbe` for validating pip hub candidates.
 * Queries the hub for package targets (e.g. `@<hub>//...`) and returns the
 * full result triple so the caller can check for `:pkg` labels or alias
 * rules. Does NOT require `pypi_name=` tags in the hub output, because
 * those tags live on spoke repos, not the hub alias layer.
 */
export function buildPypiProbeFor(config: BazelQueryOptions): RepoProbe {
  return async (hubName: string) => {
    const queryStr = `@${hubName}//...`
    const result = await runBazelQuery(queryStr, config)
    return { code: result.code, stderr: result.stderr, stdout: result.stdout }
  }
}

// Build the shared startup-flag prefix for any bazel invocation. Centralised
// so `--output_user_root` propagates to every spawn — principle 7 of the
// Maven design requires per-invocation server isolation across query,
// cquery, and `bazel mod` commands alike.
export function buildStartupFlags(config: BazelQueryOptions): string[] {
  const cfg = { __proto__: null, ...config } as BazelQueryOptions
  const startup: string[] = []
  if (cfg.bazelRc) {
    startup.push(`--bazelrc=${cfg.bazelRc}`)
  }
  if (cfg.outputUserRoot) {
    startup.push(`--output_user_root=${cfg.outputUserRoot}`)
  }
  if (cfg.bazelOutputBase) {
    startup.push(`--output_base=${cfg.bazelOutputBase}`)
  }
  return startup
}

export function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

export function excerpt(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) {
    return value
  }
  return `${value.slice(0, maxBytes)}\n[truncated]`
}

export function logBazelTrace({
  argv,
  durationMs,
  options,
  result,
  step,
}: {
  argv: string[]
  durationMs: number
  options: BazelQueryOptions
  result: BazelQueryResult
  step: string
}): void {
  if (!options.verbose) {
    return
  }
  const stderrBytes = byteLength(result.stderr)
  const stdoutBytes = byteLength(result.stdout)
  const category = result.code === 0 ? 'ok' : 'bazel-query-failed'
  logger.log('[VERBOSE] bazel subprocess trace:', `category=${category}`, {
    argv,
    category,
    code: result.code,
    cwd: options.cwd,
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

export function normalizeSpawnError(error: unknown): BazelQueryResult {
  const e = error as {
    // oxlint-disable-next-line typescript/no-redundant-type-constituents -- fleet optional-explicit-undefined convention: the explicit | undefined on an optional is intentional, not redundant.
    code?: unknown | undefined
    // oxlint-disable-next-line typescript/no-redundant-type-constituents -- fleet optional-explicit-undefined convention: the explicit | undefined on an optional is intentional, not redundant.
    status?: unknown | undefined
    // oxlint-disable-next-line typescript/no-redundant-type-constituents -- fleet optional-explicit-undefined convention: the explicit | undefined on an optional is intentional, not redundant.
    stderr?: unknown | undefined
    // oxlint-disable-next-line typescript/no-redundant-type-constituents -- fleet optional-explicit-undefined convention: the explicit | undefined on an optional is intentional, not redundant.
    stdout?: unknown | undefined
  }
  return {
    code: numericExitCode(e?.code) ?? numericExitCode(e?.status) ?? -1,
    stderr: stringField(e?.stderr),
    stdout: stringField(e?.stdout),
  }
}

export function numericExitCode(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Bzlmod-native Maven hub enumeration via the rules_jvm_external maven
 * extension. The text-format report lists every repo the extension
 * generated; `parseShowExtensionOutput` (bazel-repo-discovery.mts)
 * extracts the hubs from the `Fetched repositories:` section.
 */
export async function runBazelModShowMavenExtension(
  config: BazelQueryOptions,
): Promise<BazelQueryResult> {
  return await runBazelOneShot(
    buildBazelModShowMavenExtensionArgv(config),
    config,
    'bazel mod show_extension rules_jvm_external maven',
  )
}

/**
 * Bzlmod-native rules_python pip extension usage inspection. Used by the
 * PyPI path; kept here since the argv shape is identical to the maven
 * variant modulo the extension target.
 */
export async function runBazelModShowPipExtension(
  config: BazelQueryOptions,
): Promise<BazelQueryResult> {
  return await runBazelOneShot(
    buildBazelModShowPipExtensionArgv(config),
    config,
    'bazel mod show_extension rules_python pip',
  )
}

/**
 * Bzlmod-native visible repository enumeration. NOTE: only consumed by the
 * legacy PyPI path; the Maven path uses `runBazelModShowMavenExtension`
 * instead because `dump_repo_mapping` over-enumerates apparent names that
 * are not Maven hubs.
 */
export async function runBazelModShowVisibleRepos(
  config: BazelQueryOptions,
): Promise<BazelQueryResult> {
  return await runBazelOneShot(
    buildBazelModShowVisibleReposArgv(config),
    config,
    'bazel mod dump_repo_mapping',
  )
}

export async function runBazelOneShot(
  argv: string[],
  config: BazelQueryOptions,
  step: string,
): Promise<BazelQueryResult> {
  const cfg = { __proto__: null, ...config } as BazelQueryOptions
  if (cfg.verbose) {
    logger.log('[VERBOSE] Executing:', cfg.bin, ', args:', argv)
  }
  const startedAt = Date.now()
  let result: BazelQueryResult
  try {
    const output = await spawn(cfg.bin, argv, {
      cwd: cfg.cwd,
      timeout: BAZEL_QUERY_TIMEOUT_MS,
      ...(cfg.env ? { env: cfg.env } : {}),
    })
    const { code, stderr, stdout } = output
    result = { code, stderr, stdout }
  } catch (e) {
    result = normalizeSpawnError(e)
  }
  logBazelTrace({
    argv,
    durationMs: Date.now() - startedAt,
    options: cfg,
    result,
    step,
  })
  return result
}

/**
 * Run `bazel query` with the standardized argv shape and capture
 * stdout/stderr/code. Wraps the call in a spinner that resolves on success
 * and fails on non-zero exit. Rejected spawn calls are normalized into a
 * BazelQueryResult so retry/skip handling can inspect stderr.
 */
export async function runBazelQuery(
  queryStr: string,
  config: BazelQueryOptions,
  output?: string | undefined,
): Promise<BazelQueryResult> {
  const cfg = { __proto__: null, ...config } as BazelQueryOptions
  const argv = buildBazelArgv(queryStr, cfg, output)
  if (cfg.verbose) {
    logger.log('[VERBOSE] Executing:', cfg.bin, ', args:', argv)
  }
  const startedAt = Date.now()
  const spinner = getDefaultSpinner()
  let result: BazelQueryResult | undefined
  try {
    spinner.start(`Running bazel query (${queryStr.slice(0, 80)})…`)
    const spawnOutput = await spawn(cfg.bin, argv, {
      cwd: cfg.cwd,
      timeout: BAZEL_QUERY_TIMEOUT_MS,
      ...(cfg.env ? { env: cfg.env } : {}),
    })
    const { code, stderr, stdout } = spawnOutput
    result = { code, stderr, stdout }
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
        options: cfg,
        result,
        step: `bazel query ${truncated}`,
      })
    }
  }
}

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

export function stringField(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
