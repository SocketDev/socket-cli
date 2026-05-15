/**
 * Fleet tool resolver. Inspired by Vite+'s per-tool resolver pattern
 * (separating "where does the binary live" from "how do I exec it"),
 * adapted for our pnpm-exec-driven fleet.
 *
 * One place to change when the underlying tool swaps. When the fleet
 * migrates esbuild → rolldown, only `resolveBundler()` changes; every
 * caller continues to invoke the same resolver and the swap is
 * transparent.
 *
 * Usage:
 *   const { args, envs } = resolveLinter({ mode: 'check' })
 *   await spawn('pnpm', ['exec', ...args], { env: { ...process.env, ...envs } })
 *
 * Or via the convenience runner:
 *   await runResolved(resolveLinter({ mode: 'check' }), { cwd })
 *
 * Tool selection is a single fleet-wide decision per resolver, not
 * per-repo. If a repo needs a different tool, that's drift — surface
 * it in the manifest, don't fork the resolver.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'

import { spawn } from '@socketsecurity/lib-stable/spawn'

/**
 * Result of a resolver. `args` is the full argv passed to `pnpm exec`,
 * including the tool name as the first element. `envs` is environment
 * variables the tool needs (e.g. `OXLINT_LOG=warn`).
 */
export type ResolvedTool = {
  /** Full argv for `pnpm exec`, starting with the tool name. */
  readonly args: readonly string[]
  /** Environment variables to merge into the spawn env. */
  readonly envs: Readonly<Record<string, string>>
}

export type ResolveLinterOptions = {
  /** `'check'` reports violations; `'fix'` rewrites files in place. */
  readonly mode?: 'check' | 'fix' | undefined
  /** Path to the lint config; defaults to repo-root `.oxlintrc.json`. */
  readonly config?: string | undefined
  /** Files / globs to lint; defaults to `['.']`. */
  readonly paths?: readonly string[] | undefined
}

export type ResolveFormatterOptions = {
  /** `'check'` fails on diff; `'fix'` rewrites files in place. */
  readonly mode?: 'check' | 'fix' | undefined
  /** Path to the formatter config; defaults to repo-root `.oxfmtrc.json`. */
  readonly config?: string | undefined
  /** Files / globs to format; defaults to `['.']`. */
  readonly paths?: readonly string[] | undefined
}

export type ResolveTypeCheckerOptions = {
  /** Path to the tsconfig that drives the type check. */
  readonly project: string
}

export type ResolveTestRunnerOptions = {
  /** `'run'` for one-shot, `'watch'` for the dev loop. */
  readonly mode?: 'run' | 'watch' | undefined
  /** Path to vitest config; defaults to `.config/vitest.config.mts`. */
  readonly config?: string | undefined
  /** Whether to collect coverage. */
  readonly coverage?: boolean | undefined
}

export type ResolveBundlerOptions = {
  /** Path to the build script that owns the run; informational only. */
  readonly script?: string | undefined
}

export type RunResolvedOptions = {
  /** Working directory for the spawn. */
  readonly cwd?: string | undefined
  /** Extra args appended after the resolver's defaults. */
  readonly extraArgs?: readonly string[] | undefined
  /**
   * If true, `stdout` / `stderr` are buffered and returned on the
   * resolved result. Default false (inherit terminal).
   */
  readonly capture?: boolean | undefined
}

const FLEET_LINTER_CONFIG = '.oxlintrc.json'
const FLEET_FORMATTER_CONFIG = '.oxfmtrc.json'
const FLEET_TEST_CONFIG = '.config/vitest.config.mts'

/**
 * Resolve the fleet's linter (currently Oxlint).
 *
 * Returns argv ready for `pnpm exec`. `--config` is always emitted so
 * a swap to a tool with different config-discovery rules doesn't
 * silently change behavior.
 */
export function resolveLinter(options: ResolveLinterOptions = {}): ResolvedTool {
  const { config = FLEET_LINTER_CONFIG, mode = 'check', paths = ['.'] } = options
  const args: string[] = ['oxlint', '--config', config]
  if (mode === 'fix') {
    args.push('--fix')
  }
  args.push(...paths)
  return { args, envs: {} }
}

/**
 * Resolve the fleet's formatter (currently Oxfmt).
 */
export function resolveFormatter(
  options: ResolveFormatterOptions = {},
): ResolvedTool {
  const { config = FLEET_FORMATTER_CONFIG, mode = 'fix', paths = ['.'] } = options
  const args: string[] = ['oxfmt', '--config', config]
  if (mode === 'check') {
    args.push('--check')
  } else {
    args.push('--write')
  }
  args.push(...paths)
  return { args, envs: {} }
}

/**
 * Resolve the fleet's type checker (currently `tsgo`, the
 * `@typescript/native-preview` binary).
 *
 * Always emits `--noEmit` because the fleet's `type` script is for
 * checking only — emitting goes through the bundler.
 */
export function resolveTypeChecker(
  options: ResolveTypeCheckerOptions,
): ResolvedTool {
  const { project } = options
  return {
    args: ['tsgo', '--noEmit', '-p', project],
    envs: {},
  }
}

/**
 * Resolve the fleet's test runner (currently Vitest).
 */
export function resolveTestRunner(
  options: ResolveTestRunnerOptions = {},
): ResolvedTool {
  const { config = FLEET_TEST_CONFIG, coverage = false, mode = 'run' } = options
  const args: string[] = ['vitest', mode, '--config', config]
  if (coverage) {
    args.push('--coverage')
  }
  return { args, envs: {} }
}

/**
 * Resolve the fleet's bundler. Returns esbuild today; flips to
 * rolldown when the migration documented in
 * `socket-packageurl-js/docs/rolldown-migration.md` lands fleet-wide.
 *
 * Bundler invocations in the fleet are driven from a per-repo
 * `scripts/build.mts` that imports the bundler API directly (not via
 * `pnpm exec`), so this resolver returns the binary name only — the
 * caller picks which API surface to import.
 */
export function resolveBundler(_options: ResolveBundlerOptions = {}): ResolvedTool {
  return {
    args: ['esbuild'],
    envs: {},
  }
}

/**
 * Convenience: run a `ResolvedTool` via `pnpm exec` and return the
 * result. Throws `SpawnError` on non-zero exit unless `capture` is
 * true (then the caller inspects the result).
 */
export async function runResolved(
  resolved: ResolvedTool,
  options: RunResolvedOptions = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const { capture = false, cwd = process.cwd(), extraArgs = [] } = options

  const env = { ...process.env, ...resolved.envs }
  const argv = ['exec', ...resolved.args, ...extraArgs]

  const result = await spawn('pnpm', argv, {
    cwd,
    env,
    stdioString: true,
    ...(capture ? {} : { stdio: 'inherit' as const }),
  })

  return {
    exitCode: result.code ?? 0,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  }
}

/**
 * Best-effort detection: is the named tool resolvable from the given
 * cwd's `node_modules/.bin/`? Useful for soft-failing when a repo
 * opted out of one of the fleet's tools.
 */
export function hasResolvedTool(name: string, cwd: string = process.cwd()): boolean {
  return existsSync(path.join(cwd, 'node_modules', '.bin', name))
}
