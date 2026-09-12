#!/usr/bin/env node
/**
 * @file SessionStart fetch-kernel for a THIN fleet member. A plain `git clone`
 *   of a thin member that a developer or Claude opens WITHOUT first running
 *   `pnpm install` has no `.claude/hooks/fleet` payload — it is gitignored and
 *   fetched, never committed — so the fleet hooks silently do not fire. This
 *   kernel runs at SessionStart from a TRACKED location (it survives a thin
 *   untrack), detects the absent payload, and re-materializes it through the
 *   SAME dep-0 bootstrap fetcher: `scripts/repo/bootstrap/fleet.mjs
 *   --if-current`. It never reimplements fetching — it shells the fetcher.
 *   Dep-0: node: builtins only, so it runs before node_modules exists. Plain
 *   `.mts`, type-stripped by Node, which every fleet repo already requires via
 *   `engines.node >=24` —
 *   included in the cascaded bootstrap payload by
 *   `scripts/repo/gen/bootstrap.mts`, beside `fleet.mjs`. Idempotent + fast:
 *   when the payload is already present it does a single existsSync check and
 *   exits — the common case. Fail-open: a missing fetcher or a failed fetch
 *   NEVER blocks the session; the kernel warns on STDERR and exits 0.
 *   `fleet.mjs` is dep-0 (node: builtins only), so it runs even on a bare clone
 *   with no node_modules — the kernel shells it to self-fetch the payload the
 *   moment a session opens, before any `pnpm install`. USAGE (settings.json
 *   SessionStart hook): node scripts/repo/bootstrap/fetch-session.mts.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { readFileSync as bootstrapReadFileSync } from 'node:fs'
import bootstrapProcess from 'node:process'
const bootstrapRunner = (function (
  readFileSync: typeof bootstrapReadFileSync,
  process: typeof bootstrapProcess,
) {
  interface ScriptResult {
    readonly exitCode: number
    readonly data?: unknown | undefined
    readonly error?: string | undefined
  }

  function renderScriptResult(result: ScriptResult): string {
    if (
      !Number.isInteger(result.exitCode) ||
      result.exitCode < 0 ||
      result.exitCode > 255
    ) {
      throw new Error(
        'Script result requires an integer exit code between 0 and 255.',
      )
    }
    return JSON.stringify({
      ok: result.exitCode === 0,
      exitCode: result.exitCode,
      ...(result.data === undefined ? {} : { data: result.data }),
      ...(result.error === undefined ? {} : { error: result.error }),
    })
  }

  class ScriptExit extends Error {
    readonly exitCode: number

    constructor(exitCode: number) {
      if (!Number.isInteger(exitCode) || exitCode < 1 || exitCode > 255) {
        throw new Error(
          'Script abort requires an integer exit code between 1 and 255.',
        )
      }
      super(
        `Script stopped with exit code ${exitCode}. Review the preceding diagnostic and retry.`,
      )
      this.name = 'ScriptExit'
      this.exitCode = exitCode
    }
  }

  function abortScript(exitCode: number): never {
    throw new ScriptExit(exitCode)
  }

  /**
   * True when argv carries a bare `--`.
   *
   * `pnpm run <script> -- --flag` forwards the `--` to the script, and the argv
   * parser truncates there — every flag after it is DISCARDED, not collected as
   * a positional. The script then runs with default behaviour while the caller
   * believes they passed flags. That is merely confusing for a read-only script
   * and dangerous for a destructive one: `prune:branch-backups -- --dry-run`
   * drops the `--dry-run` and performs a live run against every repo.
   *
   * Checked against `process.argv` because by the time parsing finishes the
   * dropped flags are unrecoverable — the parsed result cannot tell you what
   * was lost.
   */
  function hasBareDoubleDash(argv: readonly string[]): boolean {
    return argv.includes('--')
  }

  /**
   * The message shown when argv carries a bare `--`. Names the script so the
   * corrected command can be pasted directly.
   */
  function bareDoubleDashMessage(scriptName: string): string {
    return (
      'a bare `--` in the command line\n' +
      `  Where: the argv for ${scriptName}.\n` +
      '  Saw:   flags after `--`. The argv parser truncates there, so those ' +
      'flags were NOT applied and the script ran with its defaults.\n' +
      `  Fix:   drop the \`--\`, e.g. \`pnpm run ${scriptName} --dry-run\`.`
    )
  }

  /**
   * A script's self-description, answered without running its side effect.
   * `--describe` prints `describe` verbatim — one line, what the script does —
   * so script inventories and agents can read purpose without opening the file.
   * `-h`/`--help` prints `describe`, a blank line, then `help`, which opens
   * with a `Usage:` line naming the sanctioned invocation and lists the flags
   * `main()` actually parses.
   */
  interface ScriptMeta {
    readonly json?: 'native' | 'result' | undefined
    readonly describe: string
    readonly help: string
  }

  /**
   * The help request found on argv, if any: `--describe` wins over
   * `-h`/`--help` when both are present (the narrower ask costs one line;
   * printing both forms for a mixed argv helps no caller). Pure — exported for
   * tests.
   */
  function helpRequest(
    argv: readonly string[],
  ): 'describe' | 'help' | undefined {
    if (argv.includes('--describe')) {
      return 'describe'
    }
    if (argv.includes('-h') || argv.includes('--help')) {
      return 'help'
    }
    return undefined
  }

  /**
   * True when argv carries `--json` on its own — orthogonal to `helpRequest`,
   * which only reads `--describe`/`-h`/`--help`. A script's own `main()` calls
   * this to switch its RESULT output to structured JSON without re-parsing
   * argv itself; `--describe --json` (either order) is answered entirely by
   * the runner before `main()` runs and never reaches this predicate. Pure —
   * exported for tests and entry scripts.
   */
  function isJsonRequested(argv: readonly string[]): boolean {
    return argv.includes('--json')
  }

  /**
   * The text a help request prints: the one-liner alone for `--describe`, or
   * the one-liner + blank line + usage body for `--help`. Pure — exported for
   * tests.
   */
  function helpText(kind: 'describe' | 'help', meta: ScriptMeta): string {
    return kind === 'describe'
      ? meta.describe
      : `${meta.describe}\n\n${meta.help}`
  }

  /**
   * The `--describe --json` payload: the fleet CLI self-description manifest
   * (canonical schema: socket-wheelhouse `schemas/cli-describe.schema.json`),
   * minimal for a script — identity plus the one-line purpose; a script's flags
   * live in its `help` prose, not structured meta. Pure — exported for tests.
   */
  interface DescribeIdentity {
    readonly name: string
    readonly version: string
  }

  function describeManifestText(
    meta: ScriptMeta,
    config: DescribeIdentity,
  ): string {
    const { name, version } = { __proto__: null, ...config } as DescribeIdentity
    return JSON.stringify(
      {
        $schema:
          'https://raw.githubusercontent.com/SocketDev/socket-wheelhouse/main/schemas/cli-describe.schema.json',
        name,
        version,
        description: meta.describe,
      },
      undefined,
      2,
    )
  }

  function errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message
    }
    return String(error)
  }

  type MainFn = () =>
    | number
    | void
    | ScriptResult
    | Promise<number | void | ScriptResult>

  function scriptVersion(): string {
    try {
      const value: unknown = JSON.parse(readFileSync('package.json', 'utf8'))
      if (
        value !== null &&
        typeof value === 'object' &&
        'version' in value &&
        typeof value.version === 'string'
      ) {
        return value.version
      }
    } catch {}
    return '0.0.0'
  }

  function writeLine(text: string): void {
    process.stdout.write(`${text}\n`)
  }

  function runMainMinimal(main: MainFn, meta: ScriptMeta): void {
    void runMainMinimalAsync(main, meta)
  }

  async function runMainMinimalAsync(
    main: MainFn,
    meta: ScriptMeta,
  ): Promise<void> {
    const argv = process.argv.slice(2)
    const json = isJsonRequested(argv)
    const request = helpRequest(argv)
    const name = process.argv[1]?.split('/').pop() ?? 'script'
    if (request) {
      writeLine(
        request === 'describe' && json
          ? describeManifestText(meta, { name, version: scriptVersion() })
          : helpText(request, meta),
      )
      process.exitCode = 0
      return
    }
    try {
      if (hasBareDoubleDash(argv)) {
        throw new Error(bareDoubleDashMessage(name))
      }
      if (json && !meta.json) {
        throw new Error('This script has not declared JSON execution support.')
      }
      await invokeMinimalMain(main, meta)
    } catch (error) {
      const message = errorMessage(error)
      const exitCode = error instanceof ScriptExit ? error.exitCode : 1
      process.exitCode = exitCode
      if (json) {
        writeLine(renderScriptResult({ exitCode, error: message }))
      } else {
        process.stderr.write(`${message}\n`)
      }
    }
  }

  async function invokeMinimalMain(
    main: MainFn,
    meta: ScriptMeta,
  ): Promise<void> {
    const json = isJsonRequested(process.argv.slice(2))
    const result = await main()
    const code =
      typeof result === 'object' && result !== null ? result.exitCode : result
    if (typeof code === 'number') {
      process.exitCode = code
    } else if (!process.exitCode) {
      process.exitCode = 0
    }
    if (json && meta.json === 'result') {
      writeLine(
        renderScriptResult({
          ...(typeof result === 'object' && result !== null ? result : {}),
          exitCode: Number(process.exitCode ?? 0),
        }),
      )
    } else if (!json && typeof result === 'object' && result?.error) {
      process.stderr.write(`${result.error}\n`)
    }
  }

  return { runMainMinimal, abortScript }
})(bootstrapReadFileSync, bootstrapProcess)
const { runMainMinimal } = bootstrapRunner
type ScriptMeta = Parameters<typeof runMainMinimal>[1]

/**
 * What the kernel must do, as a pure function of on-disk state. Declared here
 * rather than in a sidecar `.d.mts`: the kernel is typed source now, so the
 * declaration and the code cannot drift apart.
 */
export type FetchPlan =
  | { action: 'fetch'; fleet: string }
  | { action: 'no-fetcher' }
  | { action: 'present' }

/**
 * Ensure the fleet payload is present, materializing it via the bootstrap
 * fetcher when it is absent. Always returns 0 — the kernel is FAIL-OPEN, so a
 * SessionStart hook can never block the session on it. Warnings go to STDERR;
 * STDOUT is left clean so SessionStart never injects fetcher chatter as
 * context.
 */
export function ensurePayload(repoRoot: string): number {
  const plan = planFetch(repoRoot)
  if (plan.action === 'present') {
    return 0
  }
  if (plan.action === 'no-fetcher') {
    warn(
      'fleet payload absent and the bootstrap fetcher ' +
        '(scripts/repo/bootstrap/fleet.mjs) is missing — run `pnpm install`.',
    )
    return 0
  }
  const result = spawnSync(process.execPath, [plan.fleet, '--if-current'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  if ((result.status ?? 1) !== 0) {
    warn(
      'fleet payload fetch reported a problem — continuing; run ' +
        '`pnpm install` if the fleet hooks are missing.',
    )
    const detail = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
    if (detail) {
      process.stderr.write(`${detail}\n`)
    }
  }
  return 0
}

/**
 * Realpath both sides: Node resolves the REAL path for `import.meta.url` while
 * `process.argv[1]` keeps the path as invoked, so a bare URL equality silently
 * skips the CLI body under a symlinked invocation.
 */
export function isMainModule(): boolean {
  const entry = process.argv[1]
  if (!entry) {
    return false
  }
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry)
  } catch {
    return false
  }
}

/**
 * Cheap sentinel check: the hook entry `.claude/hooks/fleet/index.cjs` is the
 * file every dispatch event invokes and lives inside the untracked thin
 * payload, so its presence means the payload is materialized enough for the
 * hooks to fire. A non-thin member tracks it, so this is always true there and
 * the kernel is inert.
 */
export function payloadPresent(repoRoot: string): boolean {
  return existsSync(
    path.join(repoRoot, '.claude', 'hooks', 'fleet', 'index.cjs'),
  )
}

/**
 * Decide what the kernel must do, as a pure function of on-disk state (no
 * spawn, no I/O beyond existsSync) so every branch is unit-testable:
 *
 * - `present` the payload is already materialized — no-op.
 * - `no-fetcher` the payload is absent AND the bootstrap fetcher is missing.
 * - `fetch` the payload is absent and the dep-0 fetcher is present — carries the
 *   absolute `fleet` path to invoke. `fleet.mjs` is dep-0, so this holds even
 *   with no node_modules: a bare clone self-fetches.
 */
export function planFetch(repoRoot: string): FetchPlan {
  if (payloadPresent(repoRoot)) {
    return { action: 'present' }
  }
  const fleet = path.join(repoRoot, 'scripts', 'repo', 'bootstrap', 'fleet.mjs')
  if (!existsSync(fleet)) {
    return { action: 'no-fetcher' }
  }
  return { action: 'fetch', fleet }
}

/**
 * Walk up to the nearest package.json ancestor — the same repo-root rule as the
 * sibling bootstrap files, kept dep-0 (node: builtins only). Falls back to the
 * positional three-up if none is found (this file lives three levels deep at
 * scripts/repo/bootstrap/); never throws — the kernel must stay robust.
 */
export function resolveRepoRoot(startDir: string): string {
  let cur = startDir
  const { root } = path.parse(cur)
  while (cur && cur !== root) {
    if (existsSync(path.join(cur, 'package.json'))) {
      return cur
    }
    const parent = path.dirname(cur)
    if (parent === cur) {
      break
    }
    cur = parent
  }
  return path.resolve(startDir, '..', '..', '..')
}

/**
 * Emit a fail-open warning on STDERR. STDOUT is reserved so a SessionStart hook
 * never injects kernel output into the session context.
 */
export function warn(message: string): void {
  process.stderr.write(`fleet-fetch-session: ${message}\n`)
}

export const DESCRIBE =
  're-materializes the fleet hook payload at SessionStart when a thin member was cloned without an install'

export const HELP = `Usage: node scripts/repo/bootstrap/fetch-session.mts [flags]

  --describe  print the one-line summary
  --help, -h  print this usage

A thin fleet member gitignores its .claude/hooks/fleet payload, so a clone
opened before \`pnpm install\` has no hooks and they silently never fire. This
kernel sits in a tracked location, notices the missing payload, and shells the
dep-0 fetcher \`scripts/repo/bootstrap/fleet.mjs --if-current\` to fetch it.

Fail-open: a missing fetcher or a failed fetch warns on stderr and exits 0, so
a session never blocks. Idempotent: with the payload already present it does
one existsSync and exits.`

const SCRIPT_META: ScriptMeta = {
  describe: DESCRIBE,
  help: HELP,
  json: 'result',
}

export function main(): number {
  return ensurePayload(
    resolveRepoRoot(path.dirname(fileURLToPath(import.meta.url))),
  )
}

if (isMainModule()) {
  runMainMinimal(main, SCRIPT_META)
}
