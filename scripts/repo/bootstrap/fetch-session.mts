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
 *   copied verbatim into the cascaded bootstrap payload by
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

/**
 * The one-line summary `--describe` prints.
 *
 * Spelled inline rather than through the shared `runMain` runner. That runner
 * imports `@socketsecurity/lib-stable` at top level, and this kernel runs on a
 * bare clone where no `node_modules` exists yet. Dep-0 is the whole point of
 * the file, so self-describing has to cost zero dependencies.
 */
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

/**
 * Answer `--describe` / `--help`, reporting whether the run should stop here.
 */
export function answeredSelfDescribe(argv: readonly string[]): boolean {
  if (argv.includes('--describe')) {
    process.stdout.write(`${DESCRIBE}\n`)
    return true
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${DESCRIBE}\n\n${HELP}\n`)
    return true
  }
  return false
}

if (isMainModule()) {
  process.exitCode = answeredSelfDescribe(process.argv.slice(2))
    ? 0
    : ensurePayload(
        resolveRepoRoot(path.dirname(fileURLToPath(import.meta.url))),
      )
}
