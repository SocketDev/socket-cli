#!/usr/bin/env node
// Claude Code PreToolUse hook — no-underscore-identifier-guard.
//
// Blocks Edit/Write tool calls that introduce a new underscore-prefixed
// *identifier* (function, variable, type, export). Privacy in TypeScript
// is handled by module boundaries (not exporting) or by `_internal/`
// *directory* layout — not by leading underscores on symbol names. The
// underscore-as-internal-marker convention from other languages adds
// noise without enforcement: TS doesn't treat `_foo` as private, so
// the underscore is decorative.
//
// Banned identifier shapes (recognized at edit time):
//   const _foo = ...
//   let _foo = ...
//   var _foo = ...
//   function _foo(...)
//   class _Foo {...}
//   interface _Foo {...}
//   type _Foo = ...
//   export function _foo(...)
//   export const _foo = ...
//   export { _foo }
//
// Allowed (passes through):
//   - `_internal/` directory paths — the canonical way to signal
//     module-private files. The rule is about identifiers inside
//     files, not folder layout.
//   - `_` as a single-character throwaway (`for (const _ of arr)`,
//     destructuring `({ a: _, ...rest })`) — universally understood
//     "I don't care about this value."
//   - `_$$_` / `_$` style names from generated code (rollup, swc
//     temporaries) inside files under `dist/` or `build/`.
//   - Bypass phrase `Allow underscore-identifier bypass` typed
//     verbatim in a recent user turn.
//
// Reads PreToolUse JSON payload from stdin:
//   { "tool_name": "Edit"|"Write",
//     "tool_input": { "file_path": "...", "content"|"new_string": "..." } }
//
// Exit codes:
//   0 — pass.
//   2 — block (at least one banned identifier found).
//
// Fails open on malformed payloads (exit 0 + stderr log).

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { withEditGuard } from '../_shared/payload.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const logger = getDefaultLogger()

// Match declarations that introduce a leading-underscore identifier.
// We don't try to AST-parse; the regex set covers the surface forms
// that show up in TS/JS files in practice. False positives are tolerable
// here (we'd rather catch + show the line than miss it), and the
// allowlist covers the canonical exceptions.
//
// Each regex captures the offending identifier in group 1 for the
// error message. We intentionally require at least one alpha char
// AFTER the underscore — bare `_` is allowed (throwaway).
const BANNED_DECL_PATTERNS: readonly RegExp[] = [
  // const/let/var _foo
  /\b(?:const|let|var)\s+(_[A-Za-z][A-Za-z0-9_]*)\b/g,
  // function _foo / async function _foo
  /\b(?:async\s+)?function\s*\*?\s+(_[A-Za-z][A-Za-z0-9_]*)\s*\(/g,
  // class _Foo
  /\bclass\s+(_[A-Za-z][A-Za-z0-9_]*)\b/g,
  // interface _Foo
  /\binterface\s+(_[A-Za-z][A-Za-z0-9_]*)\b/g,
  // type _Foo =
  /\btype\s+(_[A-Za-z][A-Za-z0-9_]*)\s*[=<]/g,
  // export { _foo, ... }
  /\bexport\s*\{[^}]*?\b(_[A-Za-z][A-Za-z0-9_]*)\b/g,
]

const BYPASS_PHRASE = 'Allow underscore-identifier bypass'

// Node CJS exposes `__dirname` and `__filename` as module-scoped free
// variables. ESM modules conventionally re-create them via
// `path.dirname(fileURLToPath(import.meta.url))`, so the identifiers show
// up in a `const ...` declaration. Skip those — they're matching Node's
// published names, not a `_internal` marker.
const ALLOWED_FREE_VARS = new Set(['__dirname', '__filename'])

export function findBannedIdentifiers(text: string): Finding[] {
  const findings: Finding[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    for (let pi = 0, { length } = BANNED_DECL_PATTERNS; pi < length; pi += 1) {
      const pattern = BANNED_DECL_PATTERNS[pi]!
      pattern.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = pattern.exec(line)) !== null) {
        const identifier = match[1]!
        if (ALLOWED_FREE_VARS.has(identifier)) {
          continue
        }
        findings.push({
          line: i + 1,
          identifier,
          text: line.trimEnd(),
        })
      }
    }
  }
  return findings
}

export function hasRecentBypass(transcriptPath: string | undefined): boolean {
  // Delegates to the shared transcript reader. Reads the JSONL the harness
  // points at; `normalizeBypassText` handles hyphen/em-dash/whitespace
  // normalization. Previous version checked process.env['CLAUDE_RECENT_USER_TURNS'],
  // which no harness sets — bypass channel was effectively dead.
  return bypassPhrasePresent(transcriptPath, BYPASS_PHRASE)
}

export function isGeneratedPath(filePath: string): boolean {
  return (
    filePath.includes('/dist/') ||
    filePath.includes('/build/') ||
    filePath.includes('/node_modules/')
  )
}

interface Finding {
  readonly line: number
  readonly identifier: string
  readonly text: string
}

export function isInternalDirPath(filePath: string): boolean {
  return filePath.includes('/_internal/')
}

// Hook/lint test files and oxlint-plugin rule files legitimately contain
// banned identifier *strings* as fixture data. Exempt them so the rule
// can have its own tests without bypass phrases.
export function isPluginOrHookTestPath(filePath: string): boolean {
  return (
    filePath.includes('/.claude/hooks/fleet/no-underscore-identifier-guard/') ||
    filePath.includes(
      '/.config/fleet/oxlint-plugin/rules/no-underscore-identifier.',
    ) ||
    filePath.includes('/.config/fleet/oxlint-plugin/test/no-underscore-identifier')
  )
}

// withEditGuard handles the stdin drain, tool_name gate, file_path narrow,
// content extraction (new_string / content), and fail-open on any throw.
await withEditGuard((filePath, content, payload) => {
  // Allowlist: _internal/ dirs, generated output, this rule's own
  // test/lint fixtures.
  if (
    isInternalDirPath(filePath) ||
    isGeneratedPath(filePath) ||
    isPluginOrHookTestPath(filePath)
  ) {
    return
  }

  // Only police TS/JS source.
  if (!/\.(?:c|m)?[jt]sx?$/.test(filePath)) {
    return
  }

  const text = content ?? ''
  if (!text) {
    return
  }

  const findings = findBannedIdentifiers(text)
  if (findings.length === 0) {
    return
  }

  if (hasRecentBypass(payload.transcript_path)) {
    logger.error(
      `no-underscore-identifier-guard: ${findings.length} underscore identifier(s) — bypassed via "${BYPASS_PHRASE}"\n`,
    )
    return
  }

  const lines = findings
    .map(f => `  ${filePath}:${f.line}  ${f.identifier}\n    ${f.text}`)
    .join('\n')
  logger.error(
    `no-underscore-identifier-guard: refusing to introduce underscore-prefixed identifier(s).\n` +
      `\n` +
      `${lines}\n` +
      `\n` +
      `Drop the leading underscore. Privacy in TypeScript is handled by:\n` +
      `  - not exporting the symbol (module boundary), or\n` +
      `  - placing the file under a "_internal/" directory.\n` +
      `\n` +
      `Bypass: type "${BYPASS_PHRASE}" in a recent message.\n`,
  )
  process.exitCode = 2
})
