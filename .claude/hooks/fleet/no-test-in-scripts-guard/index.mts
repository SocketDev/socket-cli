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
// The only legitimate co-located test homes are the tooling trees that own
// their own suites and have their own runners: `.config/fleet/oxlint-plugin/
// test/`, `.claude/hooks/**/test/`, `.git-hooks/**/test/`. Those are NOT under
// scripts/, so this guard never touches them.
//
// Incident: 2026-06-04 the wheelhouse had 11 scripts/fleet/test/*.test.mts +
// 22 scripts/repo/sync-scaffolding/test/*.test.mts suites that imported
// node:test and never ran in CI — the cascade engine's own tests were dead.
// Moving them to test/unit/ (vitest) surfaced a real regression (a
// lock-step-refs-resolve regex that had gone all-non-capturing). This guard
// stops the pattern recurring at edit time.
//
// Reusable test helpers belong in `test/_shared/fleet/lib/`, not a
// `scripts/**/test/helpers.mts`.
//
// Bypass: `Allow test-in-scripts bypass` in a recent user turn.
//
// Exit codes: 0 — pass; 2 — block. Fails open on any throw.

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { withEditGuard } from '../_shared/payload.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const logger = getDefaultLogger()

const BYPASS_PHRASE = 'Allow test-in-scripts bypass'

// A `*.test.*` file (test.mts/ts/js/mjs/cjs/tsx/jsx) sitting under a `scripts/`
// dir at any depth. Path normalized to `/` first so the regex stays
// single-separator.
const TEST_IN_SCRIPTS_RE =
  /(?:^|\/)scripts\/.*\.test\.[a-z]+$/

export function isTestInScripts(filePath: string): boolean {
  return TEST_IN_SCRIPTS_RE.test(normalizePath(filePath))
}

// Async IIFE rather than top-level await: directly-run `.mts` hooks aren't
// CJS-bundled, but the fleet `no-top-level-await` rule is on for this path, and
// weakening it globally is the wrong fix (no-disable-lint-rule).
void (async () => {
  await withEditGuard((filePath, _content, payload) => {
    if (!isTestInScripts(filePath)) {
      return
    }
    if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
      return
    }
    logger.error(
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
        '  Reusable test helpers go in test/_shared/fleet/lib/.',
        '  Co-located test homes (NOT under scripts/) are the only exception:',
        '  .config/fleet/oxlint-plugin/test/, .claude/hooks/**/test/,',
        '  .git-hooks/**/test/.',
        '',
        `  Bypass: type \`${BYPASS_PHRASE}\` if this is genuinely intended.`,
        '',
      ].join('\n'),
    )
    process.exitCode = 2
  })
})()
