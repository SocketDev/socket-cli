#!/usr/bin/env node
// Claude Code PreToolUse hook — no-underscore-ident-guard.
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

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

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

// Node CJS exposes `__dirname` and `__filename` as module-scoped free
// variables. ESM modules conventionally re-create them via
// `path.dirname(fileURLToPath(import.meta.url))`, so the identifiers show
// up in a `const ...` declaration. Skip those — they're matching Node's
// published names, not a `_internal` marker.
const ALLOWED_FREE_VARS = new Set(['__dirname', '__filename'])

export interface Finding {
  readonly line: number
  readonly identifier: string
  readonly text: string
}

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
        /* c8 ignore start - ALLOWED_FREE_VARS entries (__dirname, __filename) start with __ which no BANNED_DECL_PATTERNS regex can capture (_[A-Za-z]... excludes double-underscore prefix) */
        if (ALLOWED_FREE_VARS.has(identifier)) {
          continue
        }
        /* c8 ignore stop */
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

export function isGeneratedPath(filePath: string): boolean {
  return (
    normalizePath(filePath).includes('/dist/') ||
    normalizePath(filePath).includes('/build/') ||
    normalizePath(filePath).includes('/node_modules/')
  )
}

export function isInternalDirPath(filePath: string): boolean {
  return normalizePath(filePath).includes('/_internal/')
}

// Hook/lint test files and oxlint-plugin rule files legitimately contain
// banned identifier *strings* as fixture data. Exempt them so the rule
// can have its own tests without bypass phrases.
export function isPluginOrHookTestPath(filePath: string): boolean {
  return (
    normalizePath(filePath).includes(
      '/.claude/hooks/fleet/no-underscore-ident-guard/',
    ) ||
    // The rule lives at .config/fleet/oxlint-plugin/fleet/no-underscore-identifier/
    // (index.mts + test/), carrying banned `_`-prefixed identifiers as fixture
    // data; the per-rule dir prefix exempts both files.
    normalizePath(filePath).includes(
      '/.config/fleet/oxlint-plugin/fleet/no-underscore-identifier/',
    )
  )
}

export const check = editGuard(
  (filePath, content, _payload) => {
    // Allowlist: _internal/ dirs, generated output, this rule's own
    // test/lint fixtures.
    if (
      isInternalDirPath(filePath) ||
      isGeneratedPath(filePath) ||
      isPluginOrHookTestPath(filePath)
    ) {
      return undefined
    }

    // Only police TS/JS source.
    if (!/\.(?:c|m)?[jt]sx?$/.test(filePath)) {
      return undefined
    }

    const text = content ?? ''
    if (!text) {
      return undefined
    }

    const findings = findBannedIdentifiers(text)
    if (findings.length === 0) {
      return undefined
    }

    const lines = findings
      .map(f => `  ${filePath}:${f.line}  ${f.identifier}\n    ${f.text}`)
      .join('\n')
    return block(
      `no-underscore-ident-guard: refusing to introduce underscore-prefixed identifier(s).\n` +
        `\n` +
        `${lines}\n` +
        `\n` +
        `Drop the leading underscore. Privacy in TypeScript is handled by:\n` +
        `  - not exporting the symbol (module boundary), or\n` +
        `  - placing the file under a "_internal/" directory.\n`,
    )
  },
  { fleetOnly: true },
)

export const hook = defineHook({
  bypass: ['underscore-identifier'],
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'guard',
})

void runHook(hook, import.meta.url)
