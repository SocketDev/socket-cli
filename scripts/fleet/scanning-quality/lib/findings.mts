/**
 * The pure finding-algebra for the scanning-quality skill: dedupe by
 * file:line:issue, merge variant findings, drop findings the skeptics refuted by
 * majority, count by severity, and grade A-F. These were "in plain code" /
 * "merge in" / "majority refute" / grade-table steps in the skill prose; pulling
 * them into one tested module makes the dedupe key, the refute threshold, and
 * the grade rubric stable. The finder analysis, the skeptic votes, and the A-F
 * narrative synthesis stay agent-driven — this only operates on their output.
 *
 * The grade table is the fleet's one A-F rubric (report-format.md); reuse the
 * security-report owner rather than re-encoding it.
 */

import { computeGrade } from '../../lib/security-report.mts'
import type { Grade } from '../../lib/security-report.mts'

export type { Grade }

export type SeverityLabel = 'critical' | 'high' | 'medium' | 'low'

export interface QualityFinding {
  file: string
  line?: number | undefined
  issue: string
  severity: SeverityLabel
  [key: string]: unknown
}

// The dedupe key: same file + line + normalized issue. Issue text is lowercased
// and stripped of non-alphanumerics so trivial wording differences collapse.
export function findingKey(f: QualityFinding): string {
  const issue = f.issue.toLowerCase().replace(/[^a-z0-9]+/gu, '')
  return `${f.file}:${f.line ?? ''}:${issue}`
}

// Dedupe by file:line:issue, keeping the first occurrence. Pure.
export function dedupeFindings(
  findings: readonly QualityFinding[],
): QualityFinding[] {
  const seen = new Set<string>()
  const out: QualityFinding[] = []
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    const key = findingKey(f)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push(f)
  }
  return out
}

// Merge variant findings discovered in the Variant stage into the base set,
// deduping the combined list (a variant that re-finds a base finding collapses).
export function mergeVariants(
  base: readonly QualityFinding[],
  variants: readonly QualityFinding[],
): QualityFinding[] {
  return dedupeFindings([...base, ...variants])
}

export interface RefuteVote {
  isReal: boolean
}

// Drop a finding when a MAJORITY of its skeptic votes refute it (isReal=false).
// A tie keeps the finding (the conservative direction — only a clear majority
// drops). Findings with no votes are kept.
export function dropRefuted(
  findings: readonly QualityFinding[],
  votesByIndex: ReadonlyMap<number, readonly RefuteVote[]>,
): QualityFinding[] {
  return findings.filter((_f, i) => {
    const votes = votesByIndex.get(i)
    if (!votes || votes.length === 0) {
      return true
    }
    const refuted = votes.filter(v => !v.isReal).length
    // Majority refute = strictly more than half.
    return refuted * 2 <= votes.length
  })
}

export interface SeverityCounts {
  critical: number
  high: number
  medium: number
  low: number
}

export function countBySeverity(
  findings: readonly QualityFinding[],
): SeverityCounts {
  const counts: SeverityCounts = { critical: 0, high: 0, low: 0, medium: 0 }
  for (let i = 0, { length } = findings; i < length; i += 1) {
    counts[findings[i]!.severity] += 1
  }
  return counts
}

// The A-F grade for a finding set — the same rubric as scanning-security,
// delegated to the one owner so the two skills can't disagree.
export function gradeOf(findings: readonly QualityFinding[]): Grade {
  return computeGrade(countBySeverity(findings))
}
