// Commit-message content scrubbers/scanners: the scan-report-internal label
// scrubber (strips B5/M9/H3/L4 finding IDs) and the Linear reference scanner
// commit messages stay tool-agnostic. Gate-free string logic built on
// scan-core.

import { splitLines } from './scan-core.mts'

// ── Scan-report-internal label scrubber ────────────────────────────
//
// The Claude-side scan-label-in-commit-guard PreToolUse hook
// (.claude/hooks/fleet/scan-label-in-commit-guard/index.mts) BLOCKS a
// `git commit` whose message body carries scan-report-internal
// scratch-pad IDs (B5, M9, H3, L4) — the labels the
// /fleet:scanning-quality and /fleet:scanning-security skills assign to
// findings inside one review session. They mean nothing outside that
// session: a future reader of `git log` who lacks the original report
// can't decode "fix B5". This is the commit-msg-stage twin for commits
// that never route through Claude's Bash layer (subprocess / worktree /
// CI / test-harness). It MUTATES — parity with stripAiAttribution —
// scrubbing the label token in place rather than blocking, so a
// non-interactive commit still lands with a clean message.
//
// SAME matcher source as the guard's LABEL_RE (the guard keeps it
// module-private, so the source string is duplicated here, not
// imported) plus the guard's fenced-code exemption: labels inside
// triple-backtick fences are quoted log output / SQL, never a finding
// reference, so they're left untouched.
const SCAN_LABEL_RE = /(?<![A-Za-z0-9_-])[BMHL][0-9]{1,4}(?![A-Za-z0-9_-])/g
const SCAN_LABEL_FENCE_RE = /```[\s\S]*?```/g

// Removes scan-report-internal labels from a commit message, scrubbing
// the token in place, collapsing the orphaned space, so the surrounding
// subject/body text survives. Returns the cleaned text plus the count
// of label tokens removed, so the caller writes the file only when
// `removed > 0` — the same { cleaned, removed } contract as
// stripAiAttribution.
export const stripScanLabels = (
  text: string,
): { cleaned: string; removed: number } => {
  let removed = 0
  // Walk fence boundaries so labels inside ``` … ``` are preserved
  // verbatim (parity with the guard's stripFencedCode exemption).
  let cleaned = ''
  let lastIndex = 0
  SCAN_LABEL_FENCE_RE.lastIndex = 0
  const scrub = (segment: string): string =>
    segment.replace(SCAN_LABEL_RE, () => {
      removed += 1
      return ''
    })
  let fence: RegExpExecArray | null
  while ((fence = SCAN_LABEL_FENCE_RE.exec(text)) !== null) {
    cleaned += scrub(text.slice(lastIndex, fence.index))
    cleaned += fence[0]
    lastIndex = fence.index + fence[0].length
  }
  cleaned += scrub(text.slice(lastIndex))
  if (removed > 0) {
    // Collapse the spaces left behind by a scrubbed mid-sentence label
    // and trim per-line trailing whitespace so the rewrite reads clean.
    cleaned = splitLines(cleaned)
      .map(line => line.replace(/  +/g, ' ').replace(/\s+$/, ''))
      .join('\n')
  }
  return { cleaned, removed }
}

// ── Linear reference scanner ──────────────────────────────────────
//
// Linear tracking lives in Linear; commit messages stay tool-agnostic
// (the same rule appears in the canonical CLAUDE.md "public-surface
// hygiene" block). This scanner enforces it on commit messages and is
// invoked by .git-hooks/commit-msg.mts.
//
// The team-key list is enumerated from the Socket Linear workspace.
// `PATCH` is listed before `PAT` so the longest-prefix wins on
// strings like `PATCH-123` — JS regex alternation is leftmost, not
// longest, so order is load-bearing.
const LINEAR_TEAM_KEYS = [
  'ASK',
  'AUTO',
  'BOT',
  'CE',
  'CORE',
  'DAT',
  'DES',
  'DEV',
  'ENG',
  'INFRA',
  'LAB',
  'MAR',
  'MET',
  'OPS',
  'PAR',
  'PATCH',
  'PAT',
  'PLAT',
  'REA',
  'SALES',
  'SBOM',
  'SEC',
  'SMO',
  'SUP',
  'TES',
  'TI',
  'WEB',
] as const

// Match either:
//   - a team-key + dash + digits, surrounded by non-word chars (or
//     line start/end) so we don't match inside identifiers like
//     `someENG-123foo`
//   - a literal `linear.app/<path>` URL fragment
//
// `(^|[^A-Za-z0-9_])` and `($|[^A-Za-z0-9_])` are word-boundary
// equivalents that also accept end-of-line, since `\b` in JS treats
// punctuation as a word boundary inconsistently.
const LINEAR_REF_RE = new RegExp(
  `(^|[^A-Za-z0-9_])(${LINEAR_TEAM_KEYS.join('|')})-[0-9]+($|[^A-Za-z0-9_])|linear\\.app/[A-Za-z0-9/_-]+`,
  'g',
)

// Capture groups for LINEAR_REF_RE:
//   - match[0]: full match including the leading/trailing word
//     boundary chars (or the linear.app URL).
//   - match[1]: leading non-word char, when the team-key branch matched.
//   - match[2]: team key, when the team-key branch matched.
// Use the team-key branch's middle chunk by re-extracting `<KEY>-<N>`
// from match[0]; the URL branch returns match[0] verbatim minus the
// surrounding word boundaries, which it doesn't have.
const LINEAR_KEY_DIGITS_RE = new RegExp(
  `(${LINEAR_TEAM_KEYS.join('|')})-[0-9]+`,
)

// Returns up to `limit` distinct Linear-style references found in
// `text`. Comment lines (lines starting with `#`, after the leading
// whitespace is stripped) are ignored — git uses those for the
// "Please enter the commit message" hint and we don't want to flag
// references that appeared in the diff snippet that git inlined.
export const scanLinearRefs = (text: string, limit = 5): string[] => {
  const hits: string[] = []
  for (const rawLine of splitLines(text)) {
    if (rawLine.trimStart().startsWith('#')) {
      continue
    }
    LINEAR_REF_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = LINEAR_REF_RE.exec(rawLine))) {
      // Extract the canonical reference: `KEY-NNN` for team-key
      // matches, or the linear.app/... fragment verbatim.
      const inner = LINEAR_KEY_DIGITS_RE.exec(match[0])
      const ref = inner ? inner[0] : match[0]
      if (!hits.includes(ref)) {
        hits.push(ref)
        if (hits.length >= limit) {
          return hits
        }
      }
    }
  }
  return hits
}
