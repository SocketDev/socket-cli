#!/usr/bin/env node
/*
 * @file Run the range-consolidation analyzer over this repo and print every
 *   duplicated dependency family with the EVIDENCE behind its verdict. Not a
 *   gate: it always exits 0 on a readable tree and hands the judgment to the
 *   `deduping-dependencies` decision tree, which owns the safety call. Not a
 *   fixer either — it never writes an override, edits a manifest, or runs an
 *   install.
 *
 *   Exit codes:
 *
 *   - 0 — the ecosystem was read, whatever the verdicts say.
 *   - 1 — an adapter could not read its tree. Blindness is not absence, so an
 *     unreadable lockfile fails loud instead of printing zero families.
 */

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'
import { REPO_ROOT } from '../paths.mts'
import { buildConsolidationCandidates } from './adapter.mts'
import type { ConsolidationCandidate, EcosystemAdapter } from './adapter.mts'
import { npmEcosystemAdapter } from './ecosystems/npm.mts'
import { formatOverrideAuditReportLines } from './override-audit-report.mts'

const logger = getDefaultLogger()

// The registry. An ecosystem that structurally cannot be analyzed still belongs
// here, carrying a `notApplicableReason` so the verdict is explicit rather than
// a silent skip.
export const ECOSYSTEM_ADAPTERS: readonly EcosystemAdapter[] = [
  npmEcosystemAdapter,
]

/**
 * One candidate as human-readable lines: the verdict first, then every receipt
 * under it. Returned rather than logged so the formatting is testable.
 */
export function formatCandidateLines(
  candidate: ConsolidationCandidate,
): readonly string[] {
  const { evidence } = candidate
  const lines = [
    `${evidence.name} — ${candidate.status} (${candidate.verdict})`,
    `  resolved: ${evidence.resolvedVersions.join(', ')}`,
  ]
  if (candidate.target !== undefined) {
    lines.push(`  target: ${candidate.target}`)
  }
  if (candidate.retirableOverride) {
    lines.push(`  retirable override: this family needs no override`)
  }
  for (const row of evidence.consumers) {
    const range = row.declaredRange ?? `UNREADABLE (${row.unreadableReason})`
    lines.push(
      `  ${row.consumerKind} ${row.consumer} declares ${range}, resolved ${row.resolvedVersion}`,
      `    read from ${row.rangeSource}`,
    )
  }
  for (const widening of candidate.widenings) {
    lines.push(
      `  widen ${widening.consumer}: ${widening.declaredRange} -> ${widening.proposedRange}`,
    )
  }
  if (candidate.unprovenReason !== undefined) {
    lines.push(`  unproven: ${candidate.unprovenReason}`)
  }
  return lines
}

/**
 * The one-line tally per status, so a long report still answers "how many can I
 * actually collapse" at a glance.
 */
export function summarizeCandidateStatuses(
  candidates: readonly ConsolidationCandidate[],
): string {
  const counts = new Map<string, number>()
  for (const candidate of candidates) {
    counts.set(candidate.status, (counts.get(candidate.status) ?? 0) + 1)
  }
  return [...counts]
    .toSorted((a, b) => a[0].localeCompare(b[0]))
    .map(([status, count]) => `${count} ${status}`)
    .join(', ')
}

export async function main(): Promise<number> {
  let failed = false
  for (
    let a = 0, { length: adapterCount } = ECOSYSTEM_ADAPTERS;
    a < adapterCount;
    a += 1
  ) {
    const adapter = ECOSYSTEM_ADAPTERS[a]!
    const { notApplicableReason, purlType } = adapter
    if (notApplicableReason !== undefined) {
      logger.log(`${purlType}: not applicable — ${notApplicableReason}`)
      continue
    }
    if (!(await adapter.detect({ repoRoot: REPO_ROOT }))) {
      logger.log(`${purlType}: not applicable — this repo does not use it`)
      continue
    }
    const read = await adapter.readFamilies({ repoRoot: REPO_ROOT })
    if (!read.ok) {
      logger.error(`${purlType}: ${read.reason}`)
      failed = true
      continue
    }
    const candidates = buildConsolidationCandidates({
      purlType,
      readings: read.readings,
    })
    logger.log(
      `${purlType}: ${candidates.length} duplicated famil${candidates.length === 1 ? 'y' : 'ies'}` +
        `${candidates.length > 0 ? ` — ${summarizeCandidateStatuses(candidates)}` : ''}`,
    )
    for (const candidate of candidates) {
      logger.log('')
      for (const line of formatCandidateLines(candidate)) {
        logger.log(line)
      }
    }
    logger.log('')
    if (!adapter.auditOverrides) {
      logger.log(
        `${purlType}: no override audit for this ecosystem yet, so its ` +
          `override entries were NOT measured`,
      )
      continue
    }
    const audit = await adapter.auditOverrides({ repoRoot: REPO_ROOT })
    if (!audit.ok) {
      logger.error(`${purlType}: ${audit.reason}`)
      failed = true
      continue
    }
    for (const line of formatOverrideAuditReportLines({
      purlType,
      rows: audit.rows,
    })) {
      logger.log(line)
    }
  }
  return failed ? 1 : 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'reports duplicated dependency families that a range widening would collapse',
  help: 'Usage: node scripts/fleet/analyze-range-consolidation/cli.mts',
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
