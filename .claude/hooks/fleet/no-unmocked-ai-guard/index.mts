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
//     String/template-literal spans are stripped first, so a static-analysis
//     FIXTURE that merely embeds the call name in a string (the ai-spawns
//     check's own tests) does not read as a live spawn.
//   - If the content references `vi.mock(` (the test mocks something — taken as
//     the AI surface), allow.
//   - Otherwise block.
//
// Bypass: `Allow unmocked-ai-in-tests bypass` typed verbatim in a recent user
// turn. Fails open on non-test files / absent content.

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'

// A path is a test file if its basename matches `*.test.*` / `*.spec.*` or it
// lives under a `test/` / `tests/` / `__tests__/` directory.
export function isTestFilePath(filePath: string): boolean {
  const normalized = normalizePath(filePath)
  if (/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(normalized)) {
    return true
  }
  return /(?:^|\/)(?:test|tests|__tests__)\//.test(normalized)
}

// Strip string/template-literal spans so text INSIDE a literal never matches
// the call probes. A live `spawnAiAgent(` call sits in code position; the
// call name inside quotes/backticks is a fixture handed to a scanner (the
// ai-spawns check's tests build exactly that shape). Heuristic lexer, junior
// notes: a backslash skips the next char; `'`/`"` spans end at their quote or
// at a newline (real JS strings can't span lines); a backtick span runs to the
// closing backtick (template literals do span lines, and fixtures are mostly
// templates). Interpolated code inside a template is stripped with it — a
// heuristic trade that narrows toward fewer false blocks.
export function stripStringLiterals(content: string): string {
  let out = ''
  for (let i = 0, { length } = content; i < length; i += 1) {
    const ch = content[i]!
    if (ch !== "'" && ch !== '"' && ch !== '`') {
      out += ch
      continue
    }
    const quote = ch
    i += 1
    while (i < length) {
      const c = content[i]!
      if (c === '\\') {
        i += 2
        continue
      }
      if (c === quote) {
        break
      }
      if (c === '\n' && quote !== '`') {
        // Unterminated single/double quote — end the span at the line break
        // so an apostrophe in prose can't swallow the rest of the file.
        i -= 1
        break
      }
      i += 1
    }
  }
  return out
}

// True when content spawns an AI model but has no `vi.mock` to stub it.
// Matching runs on literal-stripped content: a call in code position counts,
// a call name embedded in a string fixture does not.
export function callsUnmockedAi(content: string): boolean {
  const code = stripStringLiterals(content)
  if (!/\bspawnAiAgent\s*\(/.test(code)) {
    return false
  }
  return !/\bvi\s*\.\s*mock\s*\(/.test(code)
}

export const hook = defineHook({
  check: editGuard((filePath, content) => {
    if (!content || !isTestFilePath(filePath) || !callsUnmockedAi(content)) {
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
      ].join('\n'),
    )
  }),
  bypass: ['unmocked-ai-in-tests'],
  bypassOptional: true,
  event: 'PreToolUse',
  matcher: ['Edit', 'MultiEdit', 'Write'],
  scope: 'convention',
  triggers: ['spawnAiAgent'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
