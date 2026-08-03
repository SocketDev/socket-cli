/*
 * @file The fleet's dependency-injection seam for `git`. A module that needs to
 *   ask git a question takes a `GitRunner` parameter instead of reaching for a
 *   spawn itself. Production passes `realGitRunner`; a test passes a fake (see
 *   `test/fleet/_shared/lib/fake-git.mts`). This is a SEAM, not a module mock —
 *   module mocking is banned fleet-wide, and a seam is also what lets a slow
 *   spawn-bound suite become a fast in-process one.
 *   Two properties of the real runner are load-bearing:
 *
 *   1. **Every spawn gets a sanitized env.** When a suite runs from the pre-commit
 *      or pre-push hook, git exports `GIT_DIR`, `GIT_WORK_TREE`, and
 *      `GIT_INDEX_FILE` pointing at THE LIVE repo, and git honors those above
 *      cwd-based discovery. A fixture that runs `git init` + `git commit` in a
 *      temp dir then escapes onto the real `.git/config` and HEAD. Observed
 *      damage in this fleet: a `core.bare=true` that broke every worktree
 *      operation, a junk `test@example.com` identity, and stray commits on the
 *      working branch. `sanitizeGitEnv` strips the discovery vars and pins the
 *      global and system config files to `/dev/null` on EVERY spawn, so
 *      isolation cannot be forgotten at a call site. The process-wide twin that
 *      runs once at test startup is `.git-hooks/_shared/isolate-git-env.mts`;
 *      this is the per-spawn belt to that suspenders.
 *   2. **A dead spawn never looks like empty output.** `GitRunResult.status` is
 *      `null` only when the child was killed or never started, and `0` with an
 *      empty `stdout` when git genuinely printed nothing. Collapsing those two
 *      into `''` is how a fleet security guard silently failed open under
 *      windows CI load (see `./spawn-timeout.mts`). Callers that want the text
 *      and not the bookkeeping use `runGitOrThrow`, which throws loud and names
 *      the killing signal.
 */

import process from 'node:process'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { spawnTimeoutMs } from './spawn-timeout.mts'

/**
 * Environment variables stripped before every git spawn.
 *
 * The first group is git's repo-discovery context: while any of these is set,
 * git ignores the cwd and operates on the repo they name, which is exactly how
 * a temp-dir fixture's writes land on the live repo. The second group is the
 * config-file overrides, dropped so the `/dev/null` pins below are the only
 * config git can reach.
 */
export const GIT_RUNNER_STRIPPED_ENV_VARS: readonly string[] = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CEILING_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_DIR',
  'GIT_INDEX_FILE',
  'GIT_NAMESPACE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_PREFIX',
  'GIT_WORK_TREE',
  'GIT_CONFIG',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_PARAMETERS',
]

/**
 * Matches the numbered config pairs git uses to forward `-c key=value` to a
 * child process (`GIT_CONFIG_KEY_0` with `GIT_CONFIG_VALUE_0`, and so on). They
 * are stripped alongside `GIT_CONFIG_COUNT` so an outer `git -c` cannot reach
 * into a spawn this runner makes.
 *
 * `^GIT_CONFIG_` literal prefix
 * `(?:KEY|VALUE)` either half of a pair
 * `_\d+$` the index, anchored so `GIT_CONFIG_KEY_NOT_A_PAIR` is left alone.
 */
const NUMBERED_GIT_CONFIG_RE = /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/

/**
 * The path both config-file overrides are pinned to. Git treats an unreadable
 * config path as "no config", so this is how a spawn is guaranteed not to read
 * or write the developer's real `~/.gitconfig`. Git for Windows understands
 * `/dev/null` here too, which is why there is no per-platform branch.
 */
export const GIT_NULL_CONFIG_PATH = '/dev/null'

/**
 * Wall-clock budget for one git spawn before it is killed, in milliseconds.
 * Scaled for the platform by `spawnTimeoutMs` — win32 process creation is
 * several times slower than POSIX, and a budget that is comfortable on Linux
 * kills a slow-but-alive process there.
 */
export const DEFAULT_GIT_TIMEOUT_MS = 30_000

/**
 * Cap on captured git output. The node default is 1 MB, which a `git log` or a
 * `git diff` over a large range blows through — and an overflowing spawn is
 * reported as a KILLED spawn, so a too-small cap shows up as mystery flake.
 */
const MAX_GIT_OUTPUT_BYTES = 32 * 1024 * 1024

/**
 * Per-call options accepted by every `GitRunner`.
 */
export interface GitRunnerOptions {
  /**
   * Directory the command runs in. Defaults to the current process cwd.
   */
  cwd?: string | undefined
}

/**
 * What a `GitRunner` hands back.
 *
 * `status` is the whole contract for "did this actually run": `0` means git ran
 * and succeeded, a positive number means git ran and failed, and `null` means
 * the child was killed (timeout or signal) or never started at all. Only the
 * first two say anything about `stdout`.
 *
 * `stdout` and `stderr` from the real runner arrive TRIMMED at both ends, and
 * with ANSI escapes stripped — that is the fleet spawn wrapper's behavior, not
 * a choice made here. Do not build a fake whose canned output relies on a
 * trailing newline; the real thing will not have one.
 */
export interface GitRunResult {
  status: number | null
  stdout: string
  stderr: string
}

/**
 * What the REAL runner hands back: a `GitRunResult` plus the two fields only a
 * live spawn can supply. It is a superset, so a real runner is still a
 * `GitRunner`, and a fake that returns only the three base fields still
 * satisfies the seam.
 */
export interface GitRunDetail extends GitRunResult {
  /**
   * Set when the child could not be started or was killed by the timeout.
   */
  error: Error | undefined
  /**
   * The signal that killed the child, when one did.
   */
  signal: NodeJS.Signals | null
}

/**
 * The injection seam. Take one of these as a parameter instead of spawning git
 * inline, and the same code can run against a real repo or against canned
 * output with no module mocking.
 */
export type GitRunner = (
  args: readonly string[],
  options?: GitRunnerOptions | undefined,
) => GitRunResult

/**
 * Options for {@link runGit}.
 */
export interface RunGitOptions {
  /**
   * Directory the command runs in. Defaults to the current process cwd.
   */
  cwd?: string | undefined
  /**
   * Extra environment applied AFTER sanitization. This is the escape hatch a
   * fixture uses to set its own `GIT_AUTHOR_*` identity or scoped
   * `GIT_CONFIG_*` pairs. It is applied last on purpose: sanitization exists to
   * drop INHERITED state, not to overrule what the caller deliberately asks
   * for.
   */
  env?: NodeJS.ProcessEnv | undefined
  /**
   * Override the per-spawn timeout. Defaults to the platform-scaled value.
   */
  timeoutMs?: number | undefined
}

/**
 * Options for {@link createGitRunner}.
 */
export interface CreateGitRunnerOptions {
  /**
   * Extra environment applied after sanitization on every call.
   */
  env?: NodeJS.ProcessEnv | undefined
  /**
   * Per-spawn timeout override applied on every call.
   */
  timeoutMs?: number | undefined
}

/**
 * A failed result being described. Widened over {@link GitRunResult} so a fake's
 * three-field result works here as well as a real spawn's, whose `signal` fills
 * in the reason a kill happened.
 */
export type GitFailureResult = GitRunResult & {
  signal?: NodeJS.Signals | null | undefined
}

/**
 * Options for {@link formatGitFailure}.
 */
export interface FormatGitFailureOptions {
  /**
   * Directory the command ran in, named in the message.
   */
  cwd?: string | undefined
}

/**
 * Options for {@link runGitOrThrow}.
 */
export interface RunGitOrThrowOptions {
  /**
   * Directory the command runs in. Defaults to the current process cwd.
   */
  cwd?: string | undefined
  /**
   * Runner to drive. Defaults to {@link realGitRunner}.
   */
  runner?: GitRunner | undefined
}

/**
 * Coerce a spawn's captured stream to a string. A spawn that never started
 * hands back `null` here even though the types promise a string, so this is the
 * one place that normalizes it — and it only ever produces `''` for output,
 * never for the status that says whether the spawn ran.
 */
export function gitOutputText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Return a copy of `env` with git's inherited repo-discovery and config
 * variables removed and the global and system config files pinned to
 * `/dev/null`.
 *
 * Never mutates the input, so passing `process.env` is safe.
 */
export function sanitizeGitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitized: NodeJS.ProcessEnv = { ...env }
  for (
    let i = 0, { length } = GIT_RUNNER_STRIPPED_ENV_VARS;
    i < length;
    i += 1
  ) {
    delete sanitized[GIT_RUNNER_STRIPPED_ENV_VARS[i]!]
  }
  const names = Object.keys(sanitized)
  for (let i = 0, { length } = names; i < length; i += 1) {
    const name = names[i]!
    if (NUMBERED_GIT_CONFIG_RE.test(name)) {
      delete sanitized[name]
    }
  }
  sanitized['GIT_CONFIG_GLOBAL'] = GIT_NULL_CONFIG_PATH
  sanitized['GIT_CONFIG_SYSTEM'] = GIT_NULL_CONFIG_PATH
  return sanitized
}

/**
 * Run one command with a sanitized environment and return the full detail. This
 * is the primitive every other real-git path in this module goes through.
 *
 * The captured streams come back trimmed and ANSI-stripped, because the fleet
 * spawn wrapper does that to every result. A caller that needs byte-exact
 * output has to reach past this helper.
 */
export function runGit(
  args: readonly string[],
  options?: RunGitOptions | undefined,
): GitRunDetail {
  const { cwd, env, timeoutMs } = {
    __proto__: null,
    ...options,
  } as RunGitOptions
  const baseEnv = sanitizeGitEnv(process.env)
  const spawnEnv = env ? { ...baseEnv, ...env } : baseEnv
  const result = spawnSync('git', args, {
    ...(cwd ? { cwd } : {}),
    encoding: 'utf8',
    env: spawnEnv,
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    timeout: timeoutMs ?? spawnTimeoutMs(DEFAULT_GIT_TIMEOUT_MS),
    windowsHide: true,
  })
  return {
    error: result.error,
    signal: result.signal,
    status: result.status,
    stderr: gitOutputText(result.stderr),
    stdout: gitOutputText(result.stdout),
  }
}

/**
 * The production `GitRunner`: spawns the binary with a sanitized environment
 * and the platform-scaled default timeout. Pass this wherever a `GitRunner` is
 * asked for in real code.
 */
export function realGitRunner(
  args: readonly string[],
  options?: GitRunnerOptions | undefined,
): GitRunDetail {
  const opts = { __proto__: null, ...options } as GitRunnerOptions
  return runGit(args, { cwd: opts.cwd })
}

/**
 * Build a real `GitRunner` that carries a fixed env overlay and a fixed timeout
 * on every call. A fixture uses this to bind its identity env once instead of
 * repeating it at every call site.
 */
export function createGitRunner(
  options: CreateGitRunnerOptions = {},
): GitRunner {
  const { env, timeoutMs } = {
    __proto__: null,
    ...options,
  } as CreateGitRunnerOptions
  return function boundGitRunner(args, runOptions) {
    return runGit(args, { cwd: runOptions?.cwd, env, timeoutMs })
  }
}

/**
 * True when the command ran and exited successfully.
 */
export function isGitRunOk(result: GitRunResult): boolean {
  return result.status === 0
}

/**
 * True when the child was killed or never started. Distinct from "the command
 * ran and printed nothing", which is `status === 0` with an empty `stdout`.
 */
export function isGitRunKilled(result: GitRunResult): boolean {
  return result.status === null
}

/**
 * Build the failure message for a command that did not exit `0`, in the fleet's
 * What, Where, Saw vs. wanted, Fix order. A killed spawn is called out by name
 * — including the signal — because that is machine contention, not a defect in
 * the code under test, and reading it as one sends a debugging session down the
 * wrong path.
 */
export function formatGitFailure(
  args: readonly string[],
  result: GitFailureResult,
  options?: FormatGitFailureOptions | undefined,
): string {
  const { cwd } = { __proto__: null, ...options } as FormatGitFailureOptions
  const command = `git ${args.join(' ')}`
  const killed = isGitRunKilled(result)
  const signal = result.signal ? `, signal ${result.signal}` : ''
  const saw = killed
    ? `the spawn was killed before it exited (timeout or signal${signal})`
    : `exit ${String(result.status)}`
  const stderr = result.stderr.trim()
  const stderrLine = stderr ? `\n  Stderr: ${stderr}` : ''
  const fix = killed
    ? 'a killed spawn is machine contention, not a code defect — re-run the file on its own before treating it as a regression.'
    : 'check the arguments and the repo state above; the stderr line carries the tool’s own explanation.'
  return (
    `${command} failed.\n` +
    `  Where: ${cwd ?? 'the inherited working directory'}\n` +
    `  Saw:   ${saw}${stderrLine}\n` +
    '  Wanted: exit 0 and the command output.\n' +
    `  Fix:   ${fix}`
  )
}

/**
 * Run one command and return its stdout, throwing loud on any non-zero or
 * killed spawn.
 *
 * Use this anywhere the caller wants the text and would otherwise be tempted to
 * write `result.stdout.trim()` unconditionally. That shortcut is what turns a
 * killed spawn into an empty string that reads like a real answer, and it has
 * produced both a flaky suite and a security guard that failed open.
 */
export function runGitOrThrow(
  args: readonly string[],
  options?: RunGitOrThrowOptions | undefined,
): string {
  const { cwd, runner } = {
    __proto__: null,
    ...options,
  } as RunGitOrThrowOptions
  const run = runner ?? realGitRunner
  const result = run(args, { cwd })
  if (!isGitRunOk(result)) {
    throw new Error(formatGitFailure(args, result, { cwd }))
  }
  return result.stdout.trim()
}
