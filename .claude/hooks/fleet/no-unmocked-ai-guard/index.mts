#!/usr/bin/env node
// Claude Code PreToolUse hook — no-unmocked-ai-guard.
//
// Blocks Write/Edit on a test file that calls an AI helper (`spawnAiAgent`)
// without mocking it. Spawning a real model from a test is slow, costly, and
// non-deterministic; the fleet pattern is `vi.mock` the AI surface + assert on
// the stub. Sibling of `no-unmocked-net-guard` (which covers raw HTTP).
//
// Detection model:
//   - Fires only on Write/Edit whose target path looks like a test file
//     (`*.test.*` / `*.spec.*`, or under a `test/` / `__tests__/` directory).
//   - Looks at the post-edit content (`content` for Write, `new_string` for
//     Edit).
//   - Flags an AI call: `spawnAiAgent(` — the fleet's canonical AI-spawn helper.
//   - If the content references `vi.mock(` (the test mocks something — taken as
//     the AI surface), allow.
//   - Otherwise block.
//
// Bypass: `Allow unmocked-ai-in-tests bypass` typed verbatim in a recent user
// turn. Fails open on non-test files / absent content.

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow unmocked-ai-in-tests bypass'

// A path is a test file if its basename matches `*.test.*` / `*.spec.*` or it
// lives under a `test/` / `tests/` / `__tests__/` directory.
export function isTestFilePath(filePath: string): boolean {
  const normalized = normalizePath(filePath)
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalized)) {
    return true
  }
  return /(?:^|\/)(?:test|tests|__tests__)\//.test(normalized)
}

// True when content spawns an AI model but has no `vi.mock` to stub it.
export function callsUnmockedAi(content: string): boolean {
  if (!/\bspawnAiAgent\s*\(/.test(content)) {
    return false
  }
  return !/\bvi\s*\.\s*mock\s*\(/.test(content)
}

export const hook = defineHook({
  check: editGuard((filePath, content, payload) => {
    if (!content || !isTestFilePath(filePath) || !callsUnmockedAi(content)) {
      return undefined
    }
    if (bypassPhrasePresent(payload?.transcript_path, BYPASS_PHRASE)) {
      return undefined
    }
    return block(
      [
        '[no-unmocked-ai-guard] test spawns a real AI model.',
        '',
        `  File: ${filePath}`,
        '',
        '  This test calls `spawnAiAgent(` with no `vi.mock` — a live model',
        '  spawn from a test is slow, costly, and non-deterministic.',
        '',
        '  Fix: mock the AI surface, then assert on the stub —',
        "    vi.mock(import('@socketsecurity/lib/ai/spawn'), …)",
        '',
        `  Bypass: type "${BYPASS_PHRASE}".`,
      ].join('\n'),
    )
  }),
  event: 'PreToolUse',
  matcher: ['Edit', 'MultiEdit', 'Write'],
  scope: 'convention',
  triggers: ['spawnAiAgent'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
