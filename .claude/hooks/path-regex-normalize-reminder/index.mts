#!/usr/bin/env node
// Claude Code Stop hook — path-regex-normalize-reminder.
//
// Spots regex patterns that try to match both path separators inline
// (`[/\\]`, `[\\\\/]`, escaped backslashes inside a path-flavored regex)
// and reminds the author to use `normalizePath` from
// `@socketsecurity/lib/paths/normalize` instead, then write the regex
// against `/` only.
//
// Why: cross-platform path matching is the canonical use case for
// `normalizePath`. Hand-rolled `[/\\]` patterns get out of sync with
// each other across a codebase, are slower to read, and tend to grow
// `\\\\` escapes for path strings that have themselves been
// regex-escaped first. Normalize, then match a single separator.
//
// Scope: TypeScript / JavaScript source code blocks in the last
// assistant message. Markdown / READMEs / docs are skipped because
// example regexes there are illustrative, not run.
//
// Disable via SOCKET_PATH_REGEX_NORMALIZE_REMINDER_DISABLED.

import process from 'node:process'

import {
  bypassPhrasePresent,
  extractCodeFences,
  readLastAssistantText,
  readStdin,
} from '../_shared/transcript.mts'

interface StopPayload {
  readonly transcript_path?: string | undefined
}

interface Finding {
  pattern: string
  reason: string
}

const BYPASS_PHRASE = 'Allow path-regex-normalize bypass'
const BYPASS_LOOKBACK_USER_TURNS = 8

// Languages we care about — source files where regexes against paths
// are likely to be runtime code. Markdown / yaml / json are excluded
// because regexes in those are usually illustrative or config.
const CODE_LANGS = new Set([
  '',
  'js',
  'jsx',
  'ts',
  'tsx',
  'mjs',
  'cjs',
  'mts',
  'cts',
])

// Two separator forms inline in a single regex. Match either:
//   /[/\\]/, /[\\/]/, /[\\\\/]/  → character classes with both
//   `\\\\` and `/` literals in the same regex source
//
// We approximate by scanning the *body* of regex literals for any of:
//   - `[/\\]` or `[\\/]` (character class with both separators)
//   - `[\\\\` followed later by `/` (escaped-backslash class + slash literal)
const DUAL_SEP_RE_PATTERNS: readonly RegExp[] = [
  /\[\\\\?\/\]/, // `[/\]` / `[\\/]`
  /\[\\\\\/\]/, // `[\\/]` inside a regex string
  /\[\/\\\\\]/, // `[/\\]` inside a regex string (one of the most common)
]

// Hint signal: the regex (or nearby code) mentions a path-flavored
// fragment, suggesting this is path matching, not generic backslash
// handling.
const PATH_FLAVOR_RE =
  /(\.cache|node_modules|\/build\/|\bpaths?\.|os\.homedir|process\.cwd|fileURLToPath|path\.join|path\.resolve|path\.sep|normalize)/

/**
 * Find regex literals in `code` that match both path separators inline.
 * Returns a list of findings (pattern + reason). Includes only regexes
 * appearing within ~10 lines of path-flavored code.
 */
function findDualSeparatorRegexes(code: string): Finding[] {
  const findings: Finding[] = []

  // Match `/pattern/flags` regex literals (best-effort — JS doesn't
  // make this trivial without a real lexer).
  const regexLiteralRe = /\/((?:\\.|\[[^\]]*\]|[^/\n])+)\/[a-z]*/g
  for (const match of code.matchAll(regexLiteralRe)) {
    const body = match[1]
    if (!body) continue
    let isDual = false
    for (let i = 0, { length } = DUAL_SEP_RE_PATTERNS; i < length; i += 1) {
      const p = DUAL_SEP_RE_PATTERNS[i]!
      if (p.test(body)) {
        isDual = true
        break
      }
    }
    if (!isDual) continue

    // Confirm path context: look at a 400-char window around the match
    // for any path-flavored token.
    const idx = match.index ?? 0
    const start = Math.max(0, idx - 200)
    const end = Math.min(code.length, idx + (match[0]?.length ?? 0) + 200)
    const window = code.slice(start, end)
    if (!PATH_FLAVOR_RE.test(window)) continue

    findings.push({
      pattern: match[0]!,
      reason:
        'Dual path-separator regex. Normalize the input with `normalizePath` from `@socketsecurity/lib/paths/normalize` first, then match `/` only.',
    })
  }

  // Also catch `new RegExp("[/\\\\]")` / `new RegExp('[\\\\/]')` —
  // strings passed to the RegExp constructor where the escaped
  // backslash form is more obvious.
  const newRegexpRe =
    /new\s+RegExp\(\s*(['"`])([^'"`]*?(?:\\\\)+[/].*?|[^'"`]*?\/(?:\\\\)+.*?|[^'"`]*?\[(?:\/\\\\|\\\\\/)\][^'"`]*?)\1/g
  for (const match of code.matchAll(newRegexpRe)) {
    const body = match[2]
    if (!body) continue
    if (!body.includes('\\\\') || !body.includes('/')) continue
    const idx = match.index ?? 0
    const start = Math.max(0, idx - 200)
    const end = Math.min(code.length, idx + (match[0]?.length ?? 0) + 200)
    const window = code.slice(start, end)
    if (!PATH_FLAVOR_RE.test(window)) continue
    findings.push({
      pattern: match[0]!,
      reason:
        '`new RegExp(...)` with both separators in the pattern string. Normalize the input first; the regex stays single-separator.',
    })
  }

  return findings
}

async function main(): Promise<void> {
  const payloadRaw = await readStdin()
  if (process.env['SOCKET_PATH_REGEX_NORMALIZE_REMINDER_DISABLED']) {
    process.exit(0)
  }
  let payload: StopPayload
  try {
    payload = JSON.parse(payloadRaw) as StopPayload
  } catch {
    process.exit(0)
  }
  if (
    bypassPhrasePresent(
      payload.transcript_path,
      BYPASS_PHRASE,
      BYPASS_LOOKBACK_USER_TURNS,
    )
  ) {
    process.exit(0)
  }
  const text = readLastAssistantText(payload.transcript_path)
  if (!text) {
    process.exit(0)
  }
  const codeBlocks = extractCodeFences(text)
  if (codeBlocks.length === 0) {
    process.exit(0)
  }

  const aggregate: Finding[] = []
  for (let i = 0, { length } = codeBlocks; i < length; i += 1) {
    const block = codeBlocks[i]!
    if (!CODE_LANGS.has((block.lang ?? '').toLowerCase())) continue
    const findings = findDualSeparatorRegexes(block.body)
    for (let fi = 0, { length: flen } = findings; fi < flen; fi += 1) {
      aggregate.push(findings[fi]!)
    }
  }
  if (aggregate.length === 0) {
    process.exit(0)
  }

  const lines = [
    '[path-regex-normalize-reminder] Regex matching path separators inline:',
    '',
  ]
  for (let i = 0, { length } = aggregate; i < length; i += 1) {
    const f = aggregate[i]!
    lines.push(`  • ${f.pattern}`)
    lines.push(`      ${f.reason}`)
    lines.push('')
  }
  lines.push(
    "  Use `import { normalizePath } from '@socketsecurity/lib/paths/normalize'`,",
  )
  lines.push(
    '  then write a single-separator regex against `normalizePath(input)`.',
  )
  lines.push(
    `  Bypass: type "${BYPASS_PHRASE}" verbatim in a recent message.`,
  )
  lines.push('')
  process.stderr.write(lines.join('\n') + '\n') // socket-hook: allow console
  process.exit(0)
}

main().catch(() => {
  process.exit(0)
})
