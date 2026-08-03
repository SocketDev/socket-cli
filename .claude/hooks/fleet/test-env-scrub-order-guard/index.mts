#!/usr/bin/env node
// Claude Code PreToolUse hook — test-env-scrub-order-guard.
//
// Blocks a Write/Edit to a TEST file that wipes a cache-isolation environment
// variable AFTER setting the environment for the command it is about to spawn.
// Clause 2 of the test-isolation law
// (`scripts/fleet/_shared/test-isolation-law.mts`,
// `docs/agents.md/fleet/test-layout.md` "Isolation"): scrub the ambient
// environment FIRST, then apply the overrides. `Command`'s env operations are
// keyed by variable name and the LAST call for a name wins, so a scrub helper
// invoked after the seeding code silently undoes it.
//
// WHY A MACHINE AND NOT A REVIEWER. 2026-08-02, socket-patch:
// `e2e_vendor_yarn_classic_dev_flow.rs` seeded a private `YARN_CACHE_FOLDER`
// and then called `scrub_socket_env(&mut cmd)`, whose last act is
// `env_remove("YARN_CACHE_FOLDER")`. Both halves are correct in isolation and
// they sit eleven lines apart, in the right order for reading and the wrong
// order for execution. Nothing failed: the fixture install just used the
// developer's global yarn cache instead (165 files, measured). Its sibling
// file carries a comment about having fixed exactly this bug, and the newer
// file reintroduced it anyway — which is the case for an enforcer rather than
// another comment.
//
// DETECTION, narrow on purpose. The shared law module reports only two
// provable shapes, and this guard blocks on both:
//
//   1. A function sets a variable the law pins and then removes that same
//      variable before spawning.
//   2. A function sets env, then calls a same-file helper whose body removes a
//      variable the law pins. The origin case is this one: the caller fed the
//      key in through a `for (k, v) in extra_env` loop, so nothing at the set
//      site named it.
//
// Deliberately NOT blocked, because the false-positive evidence says so: a
// scrub of keys the law does not pin. `run_bin_with_env` in the same repo
// seeds nine `SOCKET_*` decoy values and scrubs them straight after ON
// PURPOSE, so that a dropped scrub line turns the suite red instead of leaving
// it dependent on the ambient shell. Every pattern that caught the yarn bug
// through the key name alone also caught that. Narrowing to the
// cache-isolation names is what tells them apart: nobody wants a test to
// un-set a cache redirect.
//
// Scope: test files only — `*.test.*` / `*.spec.*`, anything under `test/` /
// `tests/` / `__tests__/`, and a Rust `*_test.rs` / `*_e2e.rs`. The other two
// clauses of the law are report-only in
// `scripts/fleet/check/test-spawns-are-isolated.mts`; only this one is
// provable enough to block.
//
// Blocks (exit 2). Fails open on its own errors.
//
// Bypass: `Allow test-scrub-order bypass` in a recent user turn.

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { testIsolationSmells } from '../../../../scripts/fleet/_shared/test-isolation-law.mts'
import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'

// How many findings the block message lists before it summarizes the rest.
const MAX_LISTED = 8

/**
 * A test file: a `*.test.*` / `*.spec.*` basename, a path under a test
 * directory, or Rust's convention of a `_test` / `_e2e` filename suffix.
 */
export function isTestFilePath(filePath: string): boolean {
  const normalized = normalizePath(filePath)
  if (/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(normalized)) {
    return true
  }
  if (/(?:^|\/)(?:test|tests|__tests__)\//.test(normalized)) {
    return true
  }
  return /_(?:e2e|test|tests)\.rs$/.test(normalized)
}

export const hook = defineHook({
  bypass: ['test-scrub-order'],
  check: editGuard((filePath, content) => {
    if (!isTestFilePath(filePath) || !content) {
      return undefined
    }
    const findings = testIsolationSmells(content).filter(
      smell => smell.rule === 'scrub-before-override',
    )
    if (findings.length === 0) {
      return undefined
    }
    const keys = [...new Set(findings.map(smell => smell.key).filter(Boolean))]
    return block(
      [
        '[test-env-scrub-order-guard] Blocked: an environment scrub runs AFTER the code that sets it.',
        '',
        ...findings
          .slice(0, MAX_LISTED)
          .map(smell => `    line ${smell.line} — ${smell.detail}`),
        ...(findings.length > MAX_LISTED
          ? [`    ... and ${findings.length - MAX_LISTED} more`]
          : []),
        '',
        "  `Command`'s env operations are keyed by variable name and the LAST",
        '  call for a name wins, so the scrub silently undoes the override.',
        "  Nothing fails — the spawn just uses the developer's real cache.",
        '',
        '  Fix — put the operations in this order:',
        '    1. scrub the ambient environment,',
        '    2. apply the isolation,',
        '    3. apply the env this test specifically needs.',
        '',
        `  Variables at stake here: ${keys.join(', ')}.`,
        '  See docs/agents.md/fleet/test-layout.md ("Isolation").',
      ].join('\n'),
    )
  }),
  event: 'PreToolUse',
  matcher: ['Edit', 'MultiEdit', 'Write'],
  scope: 'convention',
  type: 'guard',
})

void runHook(hook, import.meta.url)
