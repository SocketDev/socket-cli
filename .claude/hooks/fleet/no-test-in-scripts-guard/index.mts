#!/usr/bin/env node
// Claude Code PreToolUse hook — no-test-in-scripts-guard.
//
// Blocks Edit/Write that create a `*.test.*` file anywhere under `scripts/`.
// Tests live under `test/` (test/unit/, test/isolated/, …). `scripts/` is for
// scripts. A test under `scripts/**` is INVISIBLE to the vitest runner — the
// fleet `.config/repo/vitest.config.mts` excludes `scripts/**/test/**`, and no
// other runner picks it up — so it silently never runs (false confidence:
// written, green-looking, never executed).
//
// The same invisibility applies to the cascaded co-located trees — the oxlint
// plugin's per-rule `.config/fleet/oxlint-plugin/fleet/<id>/test/`,
// `.claude/hooks/**/test/`, `.git-hooks/**/test/`: the cascaded vitest config
// excludes those too, and they ship to members + the release as dead weight no
// member can run. So wheelhouse-only hook/lint-rule/git-hook tests live under
// `test/repo/{unit,integration,e2e}/` (vitest), NOT co-located. That is gated
// by the `cascaded-fleet-trees-have-no-tests` check; this guard covers the
// `scripts/` case. See docs/agents.md/fleet/test-layout.md.
//
// Incident: 2026-06-04 the wheelhouse had 11 scripts/fleet/test/*.test.mts +
// 22 scripts/repo/sync-scaffolding/test/*.test.mts suites that imported
// node:test and never ran in CI — the cascade engine's own tests were dead.
// Moving them to test/unit/ (vitest) surfaced a real regression (a
// lock-step-refs-resolve regex that had gone all-non-capturing). This guard
// stops the pattern recurring at edit time.
//
// Reusable test helpers belong in `test/fleet/_shared/lib/`, not a
// `scripts/**/test/helpers.mts`.
//
// Exit codes: 0 — pass; 2 — block. Fails open on any throw.

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'

// A `*.test.*` file (test.mts/ts/js/mjs/cjs/tsx/jsx) sitting under a `scripts/`
// dir at any depth. Path normalized to `/` first so the regex stays
// single-separator.
const TEST_IN_SCRIPTS_RE = /(?:^|\/)scripts\/.*\.test\.[a-z]+$/

// A `scripts/` SUBFOLDER of a test tree (test/scripts/fleet/…) is
// runner-visible and exempt — the guard targets tests co-located under a
// top-level scripts/ tree, not test suites organized by subject.
const TEST_TREE_SCRIPTS_RE = /(?:^|\/)test\/(?:.*\/)?scripts\//

export function isTestInScripts(filePath: string): boolean {
  const norm = normalizePath(filePath)
  return TEST_IN_SCRIPTS_RE.test(norm) && !TEST_TREE_SCRIPTS_RE.test(norm)
}

export const check = editGuard((filePath, _content, _payload) => {
  if (!isTestInScripts(filePath)) {
    return undefined
  }
  return block(
    [
      '[no-test-in-scripts-guard] Blocked: test file under scripts/.',
      '',
      `  Path: ${normalizePath(filePath)}`,
      '',
      '  Tests live under `test/` (test/unit/, test/isolated/, …). A test',
      '  under scripts/** is excluded by the vitest config and silently',
      '  never runs. Move it:',
      '',
      '    test/unit/<name>.test.mts   not   scripts/**/test/<name>.test.mts',
      '',
      '  Reusable test helpers go in test/fleet/_shared/lib/.',
      '  Hook / lint-rule / git-hook tests are NOT co-located either — they live',
      '  under test/repo/{unit,integration,e2e}/ (vitest), gated by the',
      '  cascaded-fleet-trees-have-no-tests check.',
    ].join('\n'),
  )
})

export const hook = defineHook({
  bypass: ['test-in-scripts'],
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'guard',
})

void runHook(hook, import.meta.url)
