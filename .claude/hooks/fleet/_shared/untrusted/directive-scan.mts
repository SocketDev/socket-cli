/*
 * @file The three-pass scan that finds agent-directed directives embedded in
 *   UNTRUSTED content. Such text is DATA TO REPORT, never an instruction to
 *   follow, and this scan is how a guard or a report names what it found.
 *
 *   Every scan runs over the raw text AND a `normalizeForScan` copy (invisible
 *   characters stripped, Unicode Tag block dropped, homoglyphs folded), plus a
 *   whole-text pass with newlines folded to spaces so a directive split across
 *   lines is still caught. Same three-pass layering as prompt-injection-guard.
 */

import { normalizeForScan } from '../evasion-normalize.mts'
import { DIRECTIVE_PATTERNS } from './directive-patterns.mts'

/**
 * One embedded-directive hit: what shape matched, the 1-based line it was found
 * on, and a clipped copy of the offending text.
 */
export interface UntrustedFinding {
  readonly label: string
  readonly line: number
  readonly excerpt: string
}

// Cap the bytes scanned so a multi-megabyte fetched page cannot wedge a hook.
// A real directive lands near the top of the body that carries it. Matches
// prompt-injection-guard's own cap.
export const MAX_SCAN_BYTES = 512 * 1024

function clipExcerpt(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed
}

// Best-effort 1-based line of `fragment`'s first word within `text`.
function lineOfFragment(text: string, fragment: string): number {
  const firstWord = fragment.trim().split(/\s+/)[0]
  if (!firstWord) {
    return 1
  }
  const idx = text.toLowerCase().indexOf(firstWord.toLowerCase())
  if (idx < 0) {
    return 1
  }
  return text.slice(0, idx).split('\n').length
}

function matchedLabels(text: string): string[] {
  const out: string[] = []
  for (let i = 0, { length } = DIRECTIVE_PATTERNS; i < length; i += 1) {
    const pattern = DIRECTIVE_PATTERNS[i]!
    if (pattern.re.test(text)) {
      out.push(pattern.label)
    }
  }
  return out
}

/**
 * Every agent-directed instruction embedded in `text`, deduplicated by
 * label + line + excerpt. Empty when the text carries none.
 *
 * Three complementary passes, matching prompt-injection-guard: per line on the
 * raw text, per line on a normalized copy, and once over the whole normalized
 * text with runs of whitespace folded to a single space so a directive broken
 * across lines still reads as one sentence.
 */
export function findEmbeddedAgentDirectives(text: string): UntrustedFinding[] {
  const scanned =
    text.length > MAX_SCAN_BYTES ? text.slice(0, MAX_SCAN_BYTES) : text
  const findings: UntrustedFinding[] = []
  const seen = new Set<string>()
  const push = (finding: UntrustedFinding): void => {
    const key = `${finding.label}:${finding.line}:${finding.excerpt}`
    if (!seen.has(key)) {
      seen.add(key)
      findings.push(finding)
    }
  }

  const lines = scanned.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const raw = lines[i] ?? ''
    const labels = new Set([
      ...matchedLabels(raw),
      ...matchedLabels(normalizeForScan(raw)),
    ])
    for (const label of labels) {
      push({ excerpt: clipExcerpt(raw), label, line: i + 1 })
    }
  }

  // An HTML comment spanning several lines only reads as one block here, so the
  // folded pass is where a multi-line bait block is actually caught.
  const folded = normalizeForScan(scanned).replace(/\s+/g, ' ')
  for (let i = 0, { length } = DIRECTIVE_PATTERNS; i < length; i += 1) {
    const pattern = DIRECTIVE_PATTERNS[i]!
    if (pattern.wholeText === false) {
      continue
    }
    const match = pattern.re.exec(folded)
    if (match) {
      push({
        excerpt: clipExcerpt(match[0]),
        label: `${pattern.label} [multi-line]`,
        line: lineOfFragment(scanned, match[0]),
      })
    }
  }

  return findings
}
