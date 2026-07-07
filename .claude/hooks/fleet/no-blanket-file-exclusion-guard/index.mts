#!/usr/bin/env node
// Claude Code PreToolUse hook — no-blanket-file-exclusion-guard.
//
// Blocks Edit/Write tool calls that introduce a file-size exemption
// marker that does NOT name a real category. The only valid marker is
// `max-file-lines: <category> — <reason>`: a single hyphenated category
// word naming WHAT the file is (parser, state-machine, table, cli,
// integration-test, vendored, …) plus a separated reason for WHY it
// can't split.
//
// Why: "no blanket file exclusions". A file may not wave itself past the
// soft/hard line cap by asserting it deems itself acceptable — a marker
// like `max-file-lines: legitimate` (or `ok` / `exempt` / `acceptable`)
// is a self-judgment, not a description. It says "trust me" where the
// rule asks "what is this file". Naming a real category forces the
// author to admit the file's shape, which a reviewer can sanity-check,
// and steers the default toward SPLITTING rather than exempting.
//
// This is the edit-time layer of a three-layer defense: the
// `socket/max-file-lines` oxlint rule catches the same shape at lint
// time, and the soft/hard caps fire at every commit. Catching it at
// Write time means the padded marker never lands in the first place.
//
// HARD-CAP-ONLY: the exemption marker exempts a file only past the
// 1000-line HARD cap (the rare genuine cohesive-unit / generated case).
// A file in the SOFT band (501–1000) gets NO exemption — it must split,
// so the `socket/max-file-lines` rule ignores any marker there and reports
// anyway. This hook can't see the line count from a single Edit's
// new_string, so it enforces only the shape contract here (a marker that
// lands must name a real category + reason); the rule enforces the size
// gate. Splitting is the soft-band answer in every case — the block
// message says so.
//
// Recognized banned shapes (a size-exemption marker that fails the
// `<category> — <reason>` contract):
//   max-file-lines: legitimate                       (self-judgment, no category)
//   max-file-lines: legitimate — one cohesive module (self-judgment leads)
//   max-file-lines: ok — it's fine                    (self-judgment word)
//   max-file-lines: parser                            (category, no reason)
//
// Allowed shapes (pass through):
//   max-file-lines: parser — recursive-descent grammar
//   max-file-lines: state-machine — exhaustive transition table
//   max-file-lines: integration-test — one end-to-end scenario
//
// The valid-marker regex is kept in lock-step with the
// `socket/max-file-lines` oxlint rule's BYPASS_RE — both must agree on
// what a real marker looks like.
//
// Only leading comments (lines 1–5) are scanned, matching the rule: a
// file-level exemption has to communicate intent at the file level, not
// buried mid-file.
//
// Reads PreToolUse JSON payload from stdin:
//   { "tool_name": "Edit"|"Write"|"MultiEdit",
//     "tool_input": { "file_path": "...", "content"|"new_string": "..." } }
//
// Exit codes:
//   0 — pass.
//   2 — block (a blanket / self-judgment marker found).
//
// Fails open on malformed payloads (exit 0 + stderr log).

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'

// A size-exemption marker is present at all (any category text after it).
const MARKER_RE = /max-file-lines:\s*\S/i

// A VALID marker: `<category> — <reason>`. The category is one hyphenated
// token immediately after the colon, immediately followed by a `—`/`-`/`:`
// separator and a non-empty reason. The self-judgment word `legitimate`
// is explicitly NOT a category. Lock-step with the `socket/max-file-lines`
// oxlint rule's BYPASS_RE — keep both in sync.
const VALID_MARKER_RE =
  /max-file-lines:\s*(?!legitimate\b)[a-z][a-z-]*\s*[—:-]\s*\S/i

// Self-judgment words that are never a real category. Reported by name so
// the fix message can point at the offending word. `legitimate` is caught
// by VALID_MARKER_RE's negative lookahead; the rest fail the contract for
// other reasons (e.g. `ok — fine` has a category-shaped `ok` that passes
// the regex), so they get an explicit denylist check.
const SELF_JUDGMENT_WORDS: readonly string[] = [
  'acceptable',
  'allowed',
  'exempt',
  'fine',
  'legit',
  'legitimate',
  'okay',
  'ok',
  'valid',
]

interface Finding {
  readonly line: number
  readonly text: string
  readonly selfJudgmentWord: string | undefined
}

export function findSelfJudgmentWord(markerLine: string): string | undefined {
  const m = /max-file-lines:\s*([a-z][a-z-]*)/i.exec(markerLine)
  if (!m) {
    return undefined
  }
  const category = m[1]!.toLowerCase()
  for (let i = 0, { length } = SELF_JUDGMENT_WORDS; i < length; i += 1) {
    if (category === SELF_JUDGMENT_WORDS[i]) {
      return category
    }
  }
  return undefined
}

export function findBlanketExclusions(text: string): Finding[] {
  const findings: Finding[] = []
  const lines = text.split('\n')
  // Scan leading comments only — match the rule's first-5-lines window so a
  // marker buried mid-file is not treated as a file-level exemption.
  const limit = Math.min(lines.length, 5)
  for (let i = 0; i < limit; i += 1) {
    const line = lines[i]!
    if (!MARKER_RE.test(line)) {
      continue
    }
    const selfJudgmentWord = findSelfJudgmentWord(line)
    // A marker is banned if it leads with a self-judgment word OR fails the
    // `<category> — <reason>` contract entirely (e.g. category with no reason).
    if (selfJudgmentWord !== undefined || !VALID_MARKER_RE.test(line)) {
      findings.push({ line: i + 1, text: line.trim(), selfJudgmentWord })
    }
  }
  return findings
}

export const check = editGuard((filePath, content) => {
  const newContent = content ?? ''
  const findings = findBlanketExclusions(newContent)
  if (findings.length === 0) {
    return undefined
  }
  const out: string[] = []
  out.push(
    '🚨 no-blanket-file-exclusion-guard: blocked Edit/Write — a `max-file-lines:` marker must name a real category.',
  )
  out.push('')
  /* c8 ignore next - editGuard returns undefined for an empty filePath before this runs */
  out.push(`File:  ${filePath || '<unknown>'}`)
  out.push('')
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    out.push(`  Line ${f.line}: ${f.text}`)
    if (f.selfJudgmentWord !== undefined) {
      out.push(
        `           \`${f.selfJudgmentWord}\` is a self-judgment, not a category.`,
      )
    }
  }
  out.push('')
  out.push('The only valid exemption marker is:')
  out.push('  max-file-lines: <category> — <reason>')
  out.push('')
  out.push(
    'where <category> is ONE hyphenated word naming WHAT the file is (parser,',
  )
  out.push(
    'state-machine, table, cli, integration-test, vendored, …) and <reason> says',
  )
  out.push(
    'WHY it cannot split. No blanket file exclusions — say what the file is,',
  )
  out.push('not that you deem it acceptable.')
  out.push('')
  out.push(
    'And the marker is HARD-CAP-ONLY (>1000 lines): a file in the soft band',
  )
  out.push(
    '(501–1000) gets NO exemption — it MUST split. So in almost every case the',
  )
  out.push(
    'answer is the same: SPLIT along a natural seam. Reach for the marker only',
  )
  out.push(
    'for a genuine single cohesive unit past 1000 lines (or a generated file).',
  )
  return block(out.join('\n') + '\n')
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'guard',
})

void runHook(hook, import.meta.url)
