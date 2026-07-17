/**
 * @file Shared "is this rule rationale a dated incident log?" matcher. The
 *   dated-citation-guard (PreToolUse, nudges at edit time) and the
 *   rule-citations-are-generic check (`check --all`, blocks committed prose)
 *   both gate on the same definition, so the two surfaces never drift on what
 *   counts as a too-specific citation. The rule (CLAUDE.md "Compound lessons
 *   into rules"): when a rule / hook / SKILL / doc cites the case that
 *   motivated it, write it GENERICALLY, framed as an example ("e.g. a cascade
 *   that shipped without its reconciled lockfile") — NOT as a dated incident
 *   log ("2026-06-07: pnpm 11.0.0 vs 11.5.1 at SHA abc1234"). Dates, version
 *   deltas, percentages, and commit SHAs age into a changelog and leak detail;
 *   the example shape is timeless. Scope: only RATIONALE prose is flagged — a
 *   line carrying a rationale marker (`**Why:**`, "incident", "Past incident",
 *   "regression", "red-lined") that ALSO carries a specificity token. A bare
 *   date elsewhere (a SHA-pin `# <tag> (YYYY-MM-DD)` comment, a `# published:
 *   YYYY-MM-DD` soak annotation, a `.gitmodules` `# name-version`, a CHANGELOG
 *   entry, a version constant in code) is NOT rationale and is left alone —
 *   those dates are required by other rules. Memory files are exempt at the
 *   path layer (see EXEMPT_PATH_RE).
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

// A line is "rationale" if it carries one of these markers. Only rationale
// lines are candidates — this keeps the matcher off required-date annotations.
const RATIONALE_MARKER_RE =
  /\*\*Why:\*\*|\b(?:past\s+)?incident\b|\bred-lined?\b|\bregressed?\b|\bregression\b/i

// Specificity tokens that turn a generic example into a dated incident log.
const SPECIFICITY_PATTERNS: ReadonlyArray<{ label: string; regex: RegExp }> = [
  // ISO-8601 date — the loudest "this is a log entry, not an example" signal.
  { label: 'ISO date (YYYY-MM-DD)', regex: /\b20\d\d-\d\d-\d\d\b/ },
  // Percentage delta (coverage 98.9%→99.15%, etc).
  {
    label: 'percentage delta',
    regex: /\b\d+(?:\.\d+)?%\s*(?:→|->|to)\s*\d+(?:\.\d+)?%/,
  },
  // Version delta — two semver-ish versions joined by vs / → / -> ("11.4.0 vs
  // 11.3.0", "bump to 11.5.0"). A SINGLE version alone is not flagged (a rule
  // may legitimately name the version it targets); the delta framing is what
  // marks a changelog entry.
  {
    label: 'version delta',
    regex:
      /\bv?\d+\.\d+(?:\.\d+)?\s*(?:vs\.?|→|->|versus)\s*v?\d+\.\d+(?:\.\d+)?\b/i,
  },
  // Commit SHA (7–40 hex) named in rationale prose ("at SHA abc1234", "broke
  // at deadbeef"). Requires a sha-ish lead-in word so prose words like
  // "deceased" or hex-looking ids elsewhere don't false-fire.
  {
    label: 'commit SHA',
    regex: /\b(?:sha|commit|at)\s+[0-9a-f]{7,40}\b/i,
  },
]

// Paths whose prose is NOT fleet-facing rule rationale, so dated citations are
// fine there. Memory files keep absolute dates for recall; CHANGELOG has its
// own date convention; lockstep headers + .gitmodules carry required version
// stamps.
export const EXEMPT_PATH_RE =
  /(?:^|\/)(?:CHANGELOG\.md|\.gitmodules|lockstep\.json)$|\/memory\/|\/\.claude\/(?:plans|reports)\//

export interface DatedCitationHit {
  readonly label: string
  readonly line: number
  readonly text: string
}

/**
 * Scan prose for dated-incident citations. Returns one hit per offending
 * rationale line (first matching specificity token wins per line). `text` is
 * the trimmed offending line, truncated for display.
 */
export function findDatedCitations(content: string): DatedCitationHit[] {
  const lines = content.split('\n')
  const hits: DatedCitationHit[] = []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (!RATIONALE_MARKER_RE.test(line)) {
      continue
    }
    for (let j = 0, { length: pLen } = SPECIFICITY_PATTERNS; j < pLen; j += 1) {
      const pattern = SPECIFICITY_PATTERNS[j]!
      if (pattern.regex.test(line)) {
        const trimmed = line.trim()
        hits.push({
          label: pattern.label,
          line: i + 1,
          text: trimmed.length > 160 ? `${trimmed.slice(0, 157)}…` : trimmed,
        })
        break
      }
    }
  }
  return hits
}

/**
 * True when `filePath` is a fleet-facing rule-prose surface whose citations
 * must be generic. Used by both the edit-time hook and the commit-time check.
 */
export function isRuleProseSurface(filePath: string): boolean {
  const normalizedFilePath = normalizePath(filePath)
  if (EXEMPT_PATH_RE.test(normalizedFilePath)) {
    return false
  }
  return (
    /(?:^|\/)CLAUDE\.md$/.test(normalizedFilePath) ||
    /(?:^|\/)docs\/agents\.md\/fleet\//.test(normalizedFilePath) ||
    /(?:^|\/)\.claude\/skills\/.*\/SKILL\.md$/.test(normalizedFilePath) ||
    /(?:^|\/)\.claude\/hooks\/fleet\/[^/]+\/README\.md$/.test(
      normalizedFilePath,
    )
  )
}
