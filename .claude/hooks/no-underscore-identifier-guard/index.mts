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

interface ToolInput {
  readonly tool_input?:
    | {
        readonly content?: string | undefined
        readonly file_path?: string | undefined
        readonly new_string?: string | undefined
        readonly old_string?: string | undefined
      }
    | undefined
  readonly tool_name?: string | undefined
}

// Match declarations that introduce a leading-underscore identifier.
// We don't try to AST-parse; the regex set covers the surface forms
// that show up in TS/JS files in practice. False positives are tolerable
// here (we'd rather catch + show the line than miss it), and the
// allowlist covers the canonical exceptions.
//
// Each regex captures the offending identifier in group 1 for the
// error message. We intentionally require at least one alpha char
// AFTER the underscore — bare `_` is allowed (throwaway).
const BANNED_DECL_PATTERNS: ReadonlyArray<RegExp> = [
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

interface Finding {
  readonly line: number
  readonly identifier: string
  readonly text: string
}

function isInternalDirPath(filePath: string): boolean {
  return filePath.includes('/_internal/')
}

function isGeneratedPath(filePath: string): boolean {
  return (
    filePath.includes('/dist/') ||
    filePath.includes('/build/') ||
    filePath.includes('/node_modules/')
  )
}

function findBannedIdentifiers(text: string): Finding[] {
  const findings: Finding[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    for (const pattern of BANNED_DECL_PATTERNS) {
      pattern.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = pattern.exec(line)) !== null) {
        findings.push({
          line: i + 1,
          identifier: match[1]!,
          text: line.trimEnd(),
        })
      }
    }
  }
  return findings
}

function hasRecentBypass(): boolean {
  // Bypass detection is delegated to the harness's transcript reader —
  // we can't see the user turn from here without parsing the env.
  // The harness sets CLAUDE_RECENT_USER_TURNS when a bypass phrase
  // hook is registered upstream; absent that, we look for it in env.
  const turns = process.env['CLAUDE_RECENT_USER_TURNS']
  if (!turns) {
    return false
  }
  return turns.includes(BYPASS_PHRASE)
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function main(): Promise<void> {
  let payload: ToolInput
  try {
    const raw = await readStdin()
    payload = JSON.parse(raw) as ToolInput
  } catch (err) {
    // Malformed payload — fail open.
    process.stderr.write(
      `no-underscore-identifier-guard: payload parse failed (${(err as Error).message})\n`,
    )
    process.exit(0)
  }

  const toolName = payload.tool_name
  if (toolName !== 'Edit' && toolName !== 'Write') {
    process.exit(0)
  }

  const filePath = payload.tool_input?.file_path ?? ''
  if (!filePath) {
    process.exit(0)
  }

  // Allowlist: _internal/ dirs + generated output paths.
  if (isInternalDirPath(filePath) || isGeneratedPath(filePath)) {
    process.exit(0)
  }

  // Only police TS/JS source.
  if (!/\.(?:m|c)?[jt]sx?$/.test(filePath)) {
    process.exit(0)
  }

  const text =
    payload.tool_input?.content ?? payload.tool_input?.new_string ?? ''
  if (!text) {
    process.exit(0)
  }

  const findings = findBannedIdentifiers(text)
  if (findings.length === 0) {
    process.exit(0)
  }

  if (hasRecentBypass()) {
    process.stderr.write(
      `no-underscore-identifier-guard: ${findings.length} underscore identifier(s) — bypassed via "${BYPASS_PHRASE}"\n`,
    )
    process.exit(0)
  }

  const lines = findings
    .map(f => `  ${filePath}:${f.line}  ${f.identifier}\n    ${f.text}`)
    .join('\n')
  process.stderr.write(
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
  process.exit(2)
}

main().catch((err: unknown) => {
  process.stderr.write(
    `no-underscore-identifier-guard: unexpected error (${(err as Error).message})\n`,
  )
  process.exit(0)
})
