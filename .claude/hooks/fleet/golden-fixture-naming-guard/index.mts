#!/usr/bin/env node
// Claude Code PreToolUse hook — golden-fixture-naming-guard.
//
// @file A committed test reference-output fixture (the on-disk oracle a test
//   diffs its `actual` result against) must be named `*.golden.json`, never
//   `*.expected.json`. `expected` collides with the `expect(actual, expected)`
//   assertion argument, so `*.expected.json` overloads one word for both the
//   file and the assertion operand; `golden` is the established
//   authority-verified-output term (Go's `testdata/*.golden`). This guard
//   blocks a Write / Edit / MultiEdit that CREATES a new `*.expected.json`
//   (editing one that already exists on disk — e.g. mid-migration — is never
//   blocked). Fleet-only: an external / sibling clone owns its own naming.
//
// Fix: name the fixture `<name>.golden.json`. A generator that mints it from a
//      reference implementation writes the `.golden.json` path; the test loads
//      and diffs that. Detail: docs/agents.md/fleet/golden-fixtures.md.
//
// Bypass: `Allow golden-fixture-naming bypass`.

import { existsSync } from 'node:fs'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { isFleetTarget } from '../_shared/fleet-context.mts'
import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow golden-fixture-naming bypass'

// Basename ends with `.expected.json` (case-insensitive extension).
const EXPECTED_JSON_RE = /\.expected\.json$/i

/**
 * If `filePath` is a `*.expected.json` fixture, return the `*.golden.json`
 * name it should use; otherwise undefined. Pure. Path is normalized first so
 * the suffix test is separator-agnostic.
 */
export function goldenTarget(filePath: string): string | undefined {
  const unix = normalizePath(filePath)
  if (!EXPECTED_JSON_RE.test(unix)) {
    return undefined
  }
  return unix.replace(EXPECTED_JSON_RE, '.golden.json')
}

export const check = editGuard((filePath, content, payload) => {
  void content
  const target = goldenTarget(filePath)
  if (!target) {
    return undefined
  }
  // Convention guard: only governs fleet repos.
  if (!isFleetTarget(payload)) {
    return undefined
  }
  // Only block CREATION of a new `.expected.json`. Editing one that already
  // exists (a pre-rule fixture, or a rename-in-progress) must never block.
  if (existsSync(filePath)) {
    return undefined
  }
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
    return undefined
  }
  return block(
    [
      '🚨 golden-fixture-naming-guard: refusing to create a `*.expected.json`',
      '   test fixture.',
      '',
      'A committed reference-output fixture is `*.golden.json`, never',
      '`*.expected.json` — `expected` collides with the `expect(actual, expected)`',
      'assertion argument; `golden` is the authority-verified-output term.',
      '',
      `Fix: name it \`${target.slice(target.lastIndexOf('/') + 1)}\`.`,
      '     Detail: docs/agents.md/fleet/golden-fixtures.md.',
      '',
      `Bypass (the user must type verbatim in a recent turn): \`${BYPASS_PHRASE}\``,
    ].join('\n'),
  )
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'MultiEdit', 'Write'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
