/*
 * @file The human-readable shape of the override audit: the per-class counts,
 *   the total, and the receipts under each entry.
 *
 *   Two things make this its own module rather than a printf inside the
 *   classifier. It is pure line-building, so a test asserts the exact text
 *   without capturing a logger, and it holds the one judgment call the audit
 *   report needs: a package the whole workspace depends on carries hundreds of
 *   identical consumer rows, and printing all of them buries the counts the
 *   payoff metric asks for. So each entry prints a HISTOGRAM of the declared
 *   ranges, which is the shape of the proof, plus a short sample of consumer
 *   rows led by the ones that decided the class.
 */

import type { ConsumerEvidence, FamilyEvidence } from './adapter.mts'
import {
  filterOverrideAuditByOrigin,
  summarizeOverrideAudit,
} from './override-audit.mts'
import type {
  OverrideAuditRow,
  OverrideAuditSummary,
  OverrideOrigin,
} from './override-audit.mts'

// How many consumer rows one entry prints before the rest become a count.
export const OVERRIDE_EVIDENCE_SAMPLE_LIMIT = 4

// How many distinct declared ranges the histogram names before the rest become
// a count.
export const OVERRIDE_RANGE_HISTOGRAM_LIMIT = 6

// Every origin the report tallies separately, in print order. The
// fleet-canonical tally is the fleet-wide payoff number, so it leads.
export const OVERRIDE_AUDIT_ORIGINS: readonly OverrideOrigin[] = [
  'fleet-canonical',
  'repo-specific',
]

/**
 * One tally line: the total audited, then the count per class.
 */
export function formatOverrideAuditSummaryLine(config: {
  readonly label: string
  readonly summary: OverrideAuditSummary
}): string {
  const { label, summary } = config
  return (
    `${label}: ${summary.total} override entr${summary.total === 1 ? 'y' : 'ies'} — ` +
    `${summary.retirable} retirable, ${summary.loadBearing} load-bearing, ` +
    `${summary.unproven} unproven`
  )
}

/**
 * The declared ranges of a family with how many consumers state each, most-used
 * first. This is the retirable proof in one line: one entry means one range,
 * and several entries name exactly what a retirement would have to survive.
 */
export function countDeclaredRangeUses(
  evidence: FamilyEvidence,
): ReadonlyArray<readonly [string, number]> {
  const counts = new Map<string, number>()
  for (const row of evidence.consumers) {
    const range =
      row.declaredRange ?? `UNREADABLE (${row.unreadableReason ?? 'no reason'})`
    counts.set(range, (counts.get(range) ?? 0) + 1)
  }
  return [...counts].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

/**
 * How early a consumer row belongs in the sample: a consumer the override moved
 * first, then one whose range could not be read, then the rest.
 */
export function rankOverrideEvidenceRow(config: {
  readonly consumer: ConsumerEvidence
  readonly forcedConsumers: ReadonlySet<string>
}): number {
  const { consumer, forcedConsumers } = config
  if (forcedConsumers.has(consumer.consumer)) {
    return 0
  }
  return consumer.declaredRange === undefined ? 1 : 2
}

/**
 * The consumer rows worth printing: the ones that decided the class, then
 * whatever else fills the sample.
 */
export function pickOverrideEvidenceSamples(
  row: OverrideAuditRow,
): readonly ConsumerEvidence[] {
  const forcedConsumers = new Set(row.forced.map(proof => proof.consumer))
  return row.evidence.consumers
    .toSorted(
      (a, b) =>
        rankOverrideEvidenceRow({ consumer: a, forcedConsumers }) -
        rankOverrideEvidenceRow({ consumer: b, forcedConsumers }),
    )
    .slice(0, OVERRIDE_EVIDENCE_SAMPLE_LIMIT)
}

/**
 * The range histogram as one line, capped so a family with many distinct ranges
 * still prints a line rather than a paragraph.
 */
export function formatDeclaredRangeHistogram(evidence: FamilyEvidence): string {
  const uses = countDeclaredRangeUses(evidence)
  const shown = uses
    .slice(0, OVERRIDE_RANGE_HISTOGRAM_LIMIT)
    .map(([range, count]) => `${range} x${count}`)
    .join(', ')
  const hidden =
    uses.length - Math.min(uses.length, OVERRIDE_RANGE_HISTOGRAM_LIMIT)
  return hidden > 0 ? `${shown}, and ${hidden} more ranges` : shown
}

/**
 * One row as human-readable lines: the class first, then the receipts under it.
 * Returned rather than logged so the formatting is testable.
 */
export function formatOverrideAuditRowLines(
  row: OverrideAuditRow,
): readonly string[] {
  const { entry, evidence } = row
  const proof = row.provenBy === undefined ? '' : ` [${row.provenBy}]`
  const { length: consumerCount } = evidence.consumers
  const lines = [
    `${entry.key} -> ${entry.value} — ${row.auditClass}${proof}`,
    `  origin: ${entry.origin}`,
    `  resolved: ${evidence.resolvedVersions.join(', ') || 'nothing in this tree'}`,
    `  consumers: ${consumerCount}`,
  ]
  if (consumerCount > 0) {
    lines.push(`  declared ranges: ${formatDeclaredRangeHistogram(evidence)}`)
  }
  const samples = pickOverrideEvidenceSamples(row)
  for (const consumer of samples) {
    const range =
      consumer.declaredRange ?? `UNREADABLE (${consumer.unreadableReason})`
    lines.push(
      `  ${consumer.consumerKind} ${consumer.consumer} declares ${range}, resolved ${consumer.resolvedVersion}`,
    )
  }
  if (consumerCount > samples.length) {
    lines.push(`  and ${consumerCount - samples.length} more consumers`)
  }
  lines.push(`  why: ${row.reason}`)
  return lines
}

/**
 * The whole audit as human-readable lines: the totals, then the per-origin
 * tallies, then every row's evidence.
 */
export function formatOverrideAuditReportLines(config: {
  readonly purlType: string
  readonly rows: readonly OverrideAuditRow[]
}): readonly string[] {
  const { purlType, rows } = config
  const lines = [
    formatOverrideAuditSummaryLine({
      label: `${purlType} overrides`,
      summary: summarizeOverrideAudit(rows),
    }),
  ]
  for (let i = 0, { length } = OVERRIDE_AUDIT_ORIGINS; i < length; i += 1) {
    const origin = OVERRIDE_AUDIT_ORIGINS[i]!
    const scoped = filterOverrideAuditByOrigin(rows, origin)
    if (scoped.length > 0) {
      lines.push(
        `  ${formatOverrideAuditSummaryLine({
          label: origin,
          summary: summarizeOverrideAudit(scoped),
        })}`,
      )
    }
  }
  for (const row of rows) {
    lines.push('')
    for (const line of formatOverrideAuditRowLines(row)) {
      lines.push(line)
    }
  }
  return lines
}
