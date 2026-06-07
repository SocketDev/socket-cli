#!/usr/bin/env node
// Claude Code PreToolUse hook — prefer-type-import-guard.
//
// Edit-time guard for the `socket/prefer-separate-type-import` lint rule: an
// inline `type` specifier inside a value import — `import { type X, Y } from
// '...'` or `import { type X } from '...'` — must be a SEPARATE statement:
//   import { Y } from '...'
//   import type { X } from '...'
//
// The lint rule already catches + autofixes this at commit, but this hook stops
// the agent writing the wrong shape in the first place (defense in depth: skill
// + hook + lint, same as prefer-fn-decl-guard). Across the fleet,
// separate `import type` statements outnumber inline `type` specifiers ~200:1 —
// the inline form is drift, and mixing the two defeats the sorted-imports rules
// that group type imports separately.
//
// Bypass: "Allow separate-type-import bypass" in a recent user turn, or

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { withEditGuard } from '../_shared/payload.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const logger = getDefaultLogger()

const BYPASS_PHRASE = 'Allow separate-type-import bypass'

// Match a value `import { ... }` statement (NOT already `import type { ... }`)
// whose brace body contains at least one inline `type` specifier. The negative
// lookahead `(?!type\b)` after `import` skips a well-formed `import type { … }`.
// `[^{}]*` keeps it to a single brace group on one logical line; multi-line
// import bodies are normalized by collapsing newlines before the test.
const INLINE_TYPE_IMPORT_RE =
  /\bimport\s+(?!type\b)(?:[A-Za-z_$][\w$]*\s*,\s*)?\{[^{}]*\btype\s+[A-Za-z_$][\w$]*[^{}]*\}\s*from\s*['"][^'"]+['"]/

function findInlineTypeImports(text: string): number {
  // Collapse intra-import newlines so a multi-line `import {\n  type X,\n}`
  // still matches the single-line RE. Only collapse whitespace runs, not the
  // whole file, to keep the count roughly per-statement.
  const normalized = text.replace(/\{[^{}]*\}/g, m => m.replace(/\s+/g, ' '))
  let count = 0
  for (const line of normalized.split('\n')) {
    if (INLINE_TYPE_IMPORT_RE.test(line)) {
      count += 1
    }
  }
  return count
}

await withEditGuard((filePath, content, payload) => {
  // Only police TS/JS source.
  if (!/\.(?:c|m)?[jt]sx?$/.test(filePath)) {
    return
  }
  const text = content ?? ''
  if (!text) {
    return
  }

  const count = findInlineTypeImports(text)
  if (count === 0) {
    return
  }

  if (bypassPhrasePresent(payload.transcript_path, [BYPASS_PHRASE])) {
    logger.error(
      `prefer-type-import-guard: ${count} inline type specifier(s) — bypassed via "${BYPASS_PHRASE}"\n`,
    )
    return
  }

  logger.error(
    [
      `[prefer-type-import-guard] ${count} inline \`type\` specifier(s) in a value import.`,
      '',
      '  Split type-only specifiers into their own statement:',
      '',
      "    import { Value } from './mod'",
      "    import type { TypeOnly } from './mod'",
      '',
      '  NOT the inline form:',
      '',
      "    import { Value, type TypeOnly } from './mod'   // ✗",
      '',
      '  Separate `import type` keeps the sorted-imports rules grouping type',
      '  imports cleanly, and is the fleet-canonical shape (~200:1 over inline).',
      `  Bypass: type "${BYPASS_PHRASE}".`,
      '',
    ].join('\n') + '\n',
  )
  process.exitCode = 2
})
