#!/usr/bin/env node
// Claude Code Stop hook — path-regex-normalize-nudge.
//
// Spots regex patterns that try to match both path separators inline
// (`[/\\]`, `[\\\\/]`, escaped backslashes inside a path-flavored regex)
// and reminds the author to use `normalizePath` from
// `@socketsecurity/lib-stable/paths/normalize` instead, then write the regex
// against `/` only.
//
// AST-based detector — uses `findRegexLiterals` from the vendored
// acorn-wasm to walk the AST and inspect each `Literal { regex }`
// node's `pattern` directly. The previous regex-driven scanner had to
// reconstruct the regex-literal grammar by hand (a regex matching
// regex literals is famously hard) and false-positived on `//` inside
// comments and `/.../` in string literals. AST-walk skips all of that
// intrinsically.
//
// For `new RegExp("...")` constructor calls, walks CallExpression
// nodes whose callee is `Identifier(RegExp)` (via the AST helper's
// CallExpression visitor).
//
// Scope: TypeScript / JavaScript source code blocks in the last
// assistant message. Markdown / READMEs / docs are skipped because
// example regexes there are illustrative, not run.
//

import { findRegexLiterals, walkSimple } from '../_shared/acorn/index.mts'
import type { AcornNode } from '../_shared/acorn/index.mts'
import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import {
  BYPASS_LOOKBACK_USER_TURNS,
  bypassPhrasePresent,
  extractCodeFences,
  readLastAssistantText,
} from '../_shared/transcript.mts'

interface Finding {
  pattern: string
  reason: string
}

const BYPASS_PHRASE = 'Allow path-regex-normalize bypass'

const CODE_LANGS = new Set([
  '',
  'cjs',
  'cts',
  'js',
  'jsx',
  'mjs',
  'mts',
  'ts',
  'tsx',
])

// Three forms of a dual-separator character class inside a regex
// pattern. The patterns are matched against the RAW regex source
// (what the AST helper reports as `pattern`), not against JS string
// escaping.
const DUAL_SEP_RE_PATTERNS: readonly RegExp[] = [
  /\[\\?\/\]/, // `[/]` or `[\/]` alone (rare; included for completeness)
  /\[\/\\\\\]/, // `[/\\]` — slash + escaped backslash
  /\[\\\\\/\]/, // `[\\/]` — escaped backslash + slash
]

// Path-flavored token signal — if any of these appear in the same
// code block as the dual-sep regex, we trigger. Otherwise the regex
// is probably matching something else (HTTP path, URL, etc.).
const PATH_FLAVOR_RE =
  /(?:\.cache|node_modules|\/build\/|\bpaths?\.|os\.homedir|process\.cwd|fileURLToPath|path\.join|path\.resolve|path\.sep|normalize)/

export function findFindings(code: string): Finding[] {
  const findings: Finding[] = []

  // Quick early-out: if the block contains no path-flavored token at
  // all, no point parsing.
  if (!PATH_FLAVOR_RE.test(code)) {
    return findings
  }

  // Regex literals via AST.
  const regexLiterals = findRegexLiterals(code)
  for (let i = 0, { length } = regexLiterals; i < length; i += 1) {
    const r = regexLiterals[i]!
    if (!isDualSeparator(r.pattern)) {
      continue
    }
    findings.push({
      pattern: `/${r.pattern}/${r.flags}`,
      reason:
        'Dual path-separator regex. Normalize the input with `normalizePath` from `@socketsecurity/lib-stable/paths/normalize` first, then match `/` only.',
    })
  }

  // `new RegExp("...")` constructor — walk CallExpression / NewExpression
  // with callee = Identifier(RegExp). The first arg is the pattern
  // string; the second (optional) is flags.
  walkSimple(code, {
    NewExpression(node: AcornNode) {
      const callee = node['callee'] as AcornNode | undefined
      if (
        !callee ||
        callee.type !== 'Identifier' ||
        (callee['name'] as string) !== 'RegExp'
      ) {
        return
      }
      /* c8 ignore next - acorn always provides arguments on NewExpression nodes; ?? [] is a defensive fallback unreachable in practice */
      const args = (node['arguments'] as AcornNode[] | undefined) ?? []
      const first = args[0]
      if (
        !first ||
        first.type !== 'Literal' ||
        typeof first['value'] !== 'string'
      ) {
        return
      }
      const pattern = first['value'] as string
      // The constructor takes the pattern as a STRING — backslash
      // escapes are JS-string escapes, so `"[/\\\\]"` in source
      // becomes `"[/\\]"` as the value, then `[/\\]` as the regex.
      // We test against the value (already one level of unescaping).
      if (!isDualSeparator(pattern)) {
        return
      }
      findings.push({
        pattern: `new RegExp(${JSON.stringify(pattern)})`,
        reason:
          '`new RegExp(...)` with both separators in the pattern string. Normalize the input first; the regex stays single-separator.',
      })
    },
  })

  return findings
}

export function isDualSeparator(pattern: string): boolean {
  for (let i = 0, { length } = DUAL_SEP_RE_PATTERNS; i < length; i += 1) {
    const p = DUAL_SEP_RE_PATTERNS[i]!
    if (p.test(pattern)) {
      return true
    }
  }
  return false
}

export const check = (payload: ToolCallPayload): GuardResult => {
  if (
    bypassPhrasePresent(
      payload.transcript_path,
      BYPASS_PHRASE,
      BYPASS_LOOKBACK_USER_TURNS,
    )
  ) {
    return undefined
  }
  const text = readLastAssistantText(payload.transcript_path)
  if (!text) {
    return undefined
  }
  const codeBlocks = extractCodeFences(text)
  if (codeBlocks.length === 0) {
    return undefined
  }

  const aggregate: Finding[] = []
  for (let i = 0, { length } = codeBlocks; i < length; i += 1) {
    const block = codeBlocks[i]!
    /* c8 ignore next - extractCodeFences always sets lang to a string; ?? '' is a defensive fallback unreachable in practice */
    if (!CODE_LANGS.has((block.lang ?? '').toLowerCase())) {
      continue
    }
    const findings = findFindings(block.body)
    for (let fi = 0, { length: flen } = findings; fi < flen; fi += 1) {
      aggregate.push(findings[fi]!)
    }
  }
  if (aggregate.length === 0) {
    return undefined
  }

  const lines = [
    '[path-regex-normalize-nudge] Regex matching path separators inline:',
    '',
  ]
  for (let i = 0, { length } = aggregate; i < length; i += 1) {
    const f = aggregate[i]!
    lines.push(`  • ${f.pattern}`)
    lines.push(`      ${f.reason}`)
    lines.push('')
  }
  lines.push(
    "  Use `import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'`,",
  )
  lines.push(
    '  then write a single-separator regex against `normalizePath(input)`.',
  )
  lines.push(`  Bypass: type "${BYPASS_PHRASE}" verbatim in a recent message.`)
  lines.push('')
  return notify(lines.join('\n'))
}

export const hook = defineHook({
  bypass: ['path-regex-normalize'],
  bypassMode: 'manual',
  bypassOptional: true,
  check,
  event: 'Stop',
  scope: 'convention',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
