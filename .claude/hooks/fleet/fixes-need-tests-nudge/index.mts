#!/usr/bin/env node
// Claude Code PreToolUse hook — fixes-need-tests-nudge.
//
// Reminder (NOT a block) on `git commit` when the STAGED change set touches
// authored source but carries NO test-file change. A code fix ships the unit
// test that covers the fixed behavior; if a layer isn't unit-testable, the
// pure logic is extracted and tested, else the PR states why. This is the
// commit-time enforcer for the "Delegated fix-work standards" rule in
// docs/agents.md/fleet/agent-delegation.md.
//
// It is a NUDGE, never a block: plenty of commits are legitimately test-free
// a docs edit, a config tweak, a pure refactor with existing coverage, so
// the reminder informs without wedging the commit.
//
// Detection is code-is-law: `isGitCommit` is the shared AST parse (tolerates
// `git -c k=v` / `git -C <dir>` prefixes), and the change set is
// `git diff --cached --name-only` — so `&&` chains and quoting in the command
// don't matter, and the paths are the real staged set, not a regex over the
// command. Authored source is a JS/TS file that is not a test, not generated,
// not a build/tool config, and not a bare type declaration; a docs/config/
// chore-only commit yields zero source files and stays silent. A cascade
// (FLEET_SYNC=1) commits a whole slice by design and is exempt.
//
// Fails open on any git error (a hygiene reminder must never wedge a commit
// over git availability).

import process from 'node:process'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { isGitCommit } from '../_shared/commit-command.mts'
import { bashGuard, defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import { resolveProjectDir } from '../_shared/project-dir.mts'
import { spawnTimeoutMs } from '../_shared/spawn-timeout.mts'

// Cap on how many source paths the reminder lists, so a large commit's
// one-line message stays readable; the overflow is summarized as a count.
const MAX_LISTED_SOURCE = 3

/**
 * True when a path is a TEST file — a change here means tests WERE touched, so
 * the nudge stays silent. Covers the co-located `.test.` / `.spec.` /
 * `.vitest.` suffixes and any file under a `test/` | `tests/` | `__tests__/`
 * directory at any depth.
 */
export function isTestFile(filePath: string): boolean {
  const normalized = normalizePath(filePath)
  return (
    // A test/ | tests/ | __tests__/ directory segment at any depth.
    /(?:^|\/)(?:test|tests|__tests__)\//.test(normalized) ||
    // A co-located `.test.` / `.spec.` / `.vitest.` JS/TS file.
    /\.(?:spec|test|vitest)\.[cm]?[jt]sx?$/.test(normalized)
  )
}

/**
 * True when a path is generated / mechanical output — never authored source,
 * so a change here is not a "needs a test" signal. Matched by directory
 * segment + basename so it holds at root or nested.
 */
export function isGeneratedPath(filePath: string): boolean {
  const normalized = normalizePath(filePath)
  const base = normalized.split('/').pop() ?? normalized
  return (
    // A build/dist output tree.
    /(?:^|\/)(?:build|dist)\//.test(normalized) ||
    // The generated hook-dispatch tree (table + bundle live here).
    /(?:^|\/)_shared\//.test(normalized) ||
    // A minified artifact.
    /\.min\.[^/]+$/.test(base) ||
    // A code-generator output marker.
    base.includes('.generated.') ||
    base === 'fleet-pack.cjs' ||
    base === 'index.cjs'
  )
}

/**
 * True when a path is AUTHORED source: a JS/TS file that is not a test, not
 * generated, not a build/tool config (`*.config.*`), and not a bare type
 * declaration (`*.d.ts` carries no runtime behavior to test). Docs (`.md`),
 * data (`.json` / `.yaml`), and every non-code file are excluded by the
 * extension test, so a docs/config/chore-only commit yields zero source files.
 */
export function isSourceFile(filePath: string): boolean {
  const normalized = normalizePath(filePath)
  const base = normalized.split('/').pop() ?? normalized
  // Only JS/TS family files carry testable runtime logic here.
  if (!/\.[cm]?[jt]sx?$/.test(base)) {
    return false
  }
  if (isTestFile(normalized) || isGeneratedPath(normalized)) {
    return false
  }
  // A type declaration or a build/tool config is not app source.
  if (base.endsWith('.d.ts') || /\.config\.[cm]?[jt]sx?$/.test(base)) {
    return false
  }
  return true
}

/**
 * The nudge verdict for a set of changed paths — the pure, unit-testable
 * core. Fires ONLY when the change set includes authored source but no test
 * change; returns `undefined` (silent) for a source+test commit, a
 * docs/config/chore-only commit, or an empty set.
 */
export function reviewChangedPaths(paths: readonly string[]): GuardResult {
  const source = paths.filter(isSourceFile)
  if (source.length === 0) {
    return undefined
  }
  if (paths.some(isTestFile)) {
    return undefined
  }
  return notify(buildMessage(source))
}

function buildMessage(source: readonly string[]): string {
  const shown = source.slice(0, MAX_LISTED_SOURCE).join(', ')
  const overflow = source.length - MAX_LISTED_SOURCE
  const more = overflow > 0 ? ` (+${overflow} more)` : ''
  return `💡 fixes-need-tests-nudge: source changed with no test change "${shown}"${more} — ship the covering unit test (or extract + test the pure logic, or state why in the PR)`
}

/**
 * The STAGED change set (`git diff --cached --name-only`) in `cwd`. Returns
 * undefined when the diff can't be computed, not a git repo, git errored —
 * the hook fails open.
 */
export function stagedPaths(cwd: string): string[] | undefined {
  const r = spawnSync('git', ['diff', '--cached', '--name-only'], {
    cwd,
    timeout: spawnTimeoutMs(5000),
  })
  if (r.status !== 0) {
    return undefined
  }
  return String(r.stdout)
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
}

export const check = bashGuard((command, payload) => {
  if (!isGitCommit(command)) {
    return undefined
  }
  // A cascade commits a whole slice by design — exempt.
  if (process.env['FLEET_SYNC'] === '1') {
    return undefined
  }
  const cwd = resolveProjectDir(payload.cwd)
  const paths = stagedPaths(cwd)
  if (!paths) {
    return undefined
  }
  return reviewChangedPaths(paths)
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  global: true,
  matcher: ['Bash'],
  scope: 'convention',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
