#!/usr/bin/env node
// Claude Code PreToolUse hook — prefer-json-clone-guard.
//
// Blocks Edit/Write tool calls that introduce a bare `structuredClone(...)`
// call into a `.ts` / `.mts` / `.cts` / `.js` / `.mjs` / `.cjs` file
// without the canonical per-line opt-out comment. The fleet rule: for
// the JSON-roundtrippable subset (anything coming from `JSON.parse`),
// `JSON.parse(JSON.stringify(x))` is 3-5x faster than `structuredClone`
// because it skips the full HTML structured-clone algorithm (type
// tagging, transferable handling, prototype preservation, cycle
// detection — none of which the JSON subset needs).
//
// When the value genuinely needs `Date` / `Map` / `Set` / `RegExp` /
// `ArrayBuffer` / typed-array preservation, opt back in with:
//
//   // oxlint-disable-next-line socket/no-structured-clone-prefer-json -- <rationale>
//   const copy = structuredClone(value)
//
// What's enforced:
//   - Any `structuredClone(...)` CALL EXPRESSION (AST-parsed via the
//     vendored acorn-wasm in `_shared/acorn/`). Member-call methods
//     (`obj.structuredClone(...)`) are correctly NOT flagged because
//     they're MemberExpression nodes, not bare Identifier calls.
//   - String-literal mentions, comment mentions, and TypeScript type
//     references are skipped — they're not CallExpression nodes.
//   - The IMMEDIATELY-PRECEDING line must contain
//     `oxlint-disable-next-line socket/no-structured-clone-prefer-json`.
//   - Lines marked `// socket-lint: allow structured-clone` are also
//     exempt for one-off legitimate cases.
//
// Bypass phrase: `Allow no-structured-clone-prefer-json bypass`.
//
// Fragment tolerance: Edit's `new_string` is a snippet that may not
// parse standalone. `tryParse` returns undefined on parse failure;
// `findBareCallsTo` returns an empty array. Hook stays fail-open on
// any parser issue.
//
// The hook fails OPEN on its own bugs (exit 0 + stderr log) so a bad
// hook deploy can't brick the session.

import process from 'node:process'

import { findBareCallsTo } from '../_shared/acorn/index.mts'

const ALLOW_MARKER = '// socket-lint: allow structured-clone'

// File extensions where the rule applies. Markdown / JSON / YAML /
// generated `.d.ts` etc. are exempt.
const APPLICABLE_EXTS = new Set(['.cjs', '.cts', '.js', '.mjs', '.mts', '.ts'])

/**
 * Apply the secondary per-line allow marker filter. The AST helper already
 * strips calls preceded by an `oxlint-disable-next-line` comment; this catches
 * the older `// socket-lint: allow structured-clone` shape (same-line or
 * preceding-line).
 */
export function applyAllowMarkerFilter(
  source: string,
  candidates: Array<{ line: number; text: string }>,
): Offense[] {
  const lines = source.split('\n')
  const out: Offense[] = []
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const c = candidates[i]!
    const line = lines[c.line - 1] ?? ''
    if (line.includes(ALLOW_MARKER)) {
      continue
    }
    const prev = c.line >= 2 ? (lines[c.line - 2] ?? '') : ''
    if (prev.includes(ALLOW_MARKER)) {
      continue
    }
    out.push({ line: c.line, text: c.text })
  }
  return out
}

interface Hook {
  tool_name?: string | undefined
  tool_input?:
    | {
        file_path?: string | undefined
        new_string?: string | undefined
        content?: string | undefined
      }
    | undefined
}

interface Offense {
  line: number
  text: string
}

export function isApplicable(filePath: string): boolean {
  if (filePath.endsWith('.d.ts') || filePath.endsWith('.d.mts')) {
    return false
  }
  const dot = filePath.lastIndexOf('.')
  if (dot === -1) {
    return false
  }
  const ext = filePath.slice(dot)
  return APPLICABLE_EXTS.has(ext)
}

function main(): void {
  let stdin = ''
  process.stdin.on('data', (chunk: Buffer) => {
    stdin += chunk.toString()
  })
  process.stdin.on('end', () => {
    try {
      let payload: Hook
      try {
        payload = JSON.parse(stdin) as Hook
      } catch {
        process.exit(0)
      }
      const tool = payload.tool_name
      if (tool !== 'Edit' && tool !== 'Write') {
        process.exit(0)
      }
      const filePath = payload.tool_input?.file_path
      if (!filePath || !isApplicable(filePath)) {
        process.exit(0)
      }
      const proposed =
        payload.tool_input?.content ?? payload.tool_input?.new_string ?? ''
      const candidates = findBareCallsTo(proposed, 'structuredClone', {
        oxlintRuleName: 'socket/no-structured-clone-prefer-json',
      })
      const offenses = applyAllowMarkerFilter(proposed, candidates)
      if (offenses.length === 0) {
        process.exit(0)
      }
      process.stderr.write(
        `[prefer-json-clone-guard] refusing edit: ` +
          `${offenses.length} bare \`structuredClone(\` call${offenses.length === 1 ? '' : 's'} ` +
          `without the canonical per-line opt-out comment:\n` +
          offenses.map(o => `    line ${o.line}: ${o.text}`).join('\n') +
          '\n\n' +
          'For JSON-roundtrippable data (anything from `JSON.parse`), use\n' +
          '`JSON.parse(JSON.stringify(x))` or `JSONParse(JSONStringify(x))` from\n' +
          '`@socketsecurity/lib/primordials/json`. It is 3-5x faster than\n' +
          '`structuredClone(...)` because it skips the full HTML structured-clone\n' +
          'algorithm (type tagging, transferable handling, prototype preservation,\n' +
          'cycle detection — none of which the JSON subset needs).\n' +
          '\n' +
          'When the value genuinely contains Date / Map / Set / RegExp /\n' +
          'ArrayBuffer / typed-array shapes that JSON would corrupt, opt back\n' +
          'in with a per-line disable + rationale:\n' +
          '\n' +
          '  // oxlint-disable-next-line socket/no-structured-clone-prefer-json -- <reason>\n' +
          '  const copy = structuredClone(value)\n' +
          '\n' +
          'One-off override: append `// socket-lint: allow structured-clone`\n' +
          'to the line. Whole-session bypass requires the user to type\n' +
          '`Allow no-structured-clone-prefer-json bypass` verbatim.\n',
      )
      process.exit(2)
    } catch (e) {
      process.stderr.write(
        `[prefer-json-clone-guard] hook error (allowing): ${e}\n`,
      )
      process.exit(0)
    }
  })
  if (process.stdin.readable === false) {
    process.exit(0)
  }
}

main()
