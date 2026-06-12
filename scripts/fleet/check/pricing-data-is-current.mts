#!/usr/bin/env node
/**
 * @file Staleness gate for the fleet's model-pricing/cost-ladder data. The
 *   model cost figures in `docs/agents.md/fleet/skill-model-routing.md` (and
 *   the companion `.claude/reports/` cost-ladder report) drive model-tier
 *   routing, but vendor prices and subscription limits move often, so a stale
 *   snapshot silently misroutes spend. The doc carries a machine-readable
 *   marker: <!-- MODEL-PRICING-SNAPSHOT: YYYY-MM-DD -- ... --> This check
 *   parses that date and reminds (non-fatal) when it is older than the
 *   freshness window. "Code is law": the prose note alone ("re-verify if
 *   stale") is policy-on-paper; this turns it into an enforced reminder that
 *   surfaces in every `check --all` run, with the exact remedy (re-run the
 *   `researching-recency` skill, refresh the figures, bump the marker date).
 *   Reminds rather than hard-fails: stale pricing data is advisory, not a
 *   correctness break, so blocking every commit fleet-wide the day the window
 *   lapses would be too aggressive. The reminder is loud (it prints in the
 *   check summary); the fix is one skill invocation. Fails open (exit 0,
 *   silent) when the doc or the marker is absent — a repo that doesn't carry
 *   the routing doc has no pricing data to keep fresh. Exit code: always 0.
 *   This surface reminds; it never blocks.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

// Days after the snapshot date before the data is considered stale. One month
// plus slack — pricing rarely changes more than monthly, and a tighter window
// would nag on routine runs.
const FRESHNESS_DAYS = 35

const ROUTING_DOC = path.join(
  REPO_ROOT,
  'docs',
  'agents.md',
  'fleet',
  'skill-model-routing.md',
)

// `<!-- MODEL-PRICING-SNAPSHOT: 2026-06-11 -- ... -->`. Captures the ISO date.
const SNAPSHOT_RE = /MODEL-PRICING-SNAPSHOT:\s*(\d{4}-\d{2}-\d{2})\b/

// Whole days between two dates (b - a), floored. Both are parsed as UTC
// midnight so DST / timezone never shifts the count.
export function daysBetween(a: Date, b: Date): number {
  const msPerDay = 86_400_000
  return Math.floor((b.getTime() - a.getTime()) / msPerDay)
}

// Parse the snapshot date from the routing-doc text. Returns undefined when the
// marker is absent or the date is unparseable (the caller fails open).
export function parseSnapshotDate(docText: string): Date | undefined {
  const match = SNAPSHOT_RE.exec(docText)
  if (!match) {
    return undefined
  }
  const parsed = new Date(`${match[1]}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  if (!existsSync(ROUTING_DOC)) {
    // Repo doesn't carry the routing doc — nothing to keep fresh.
    return
  }
  const snapshot = parseSnapshotDate(readFileSync(ROUTING_DOC, 'utf8'))
  if (!snapshot) {
    // No marker — fail open. (A repo may carry an older copy of the doc.)
    return
  }
  const now = new Date()
  const age = daysBetween(snapshot, now)
  const iso = snapshot.toISOString().slice(0, 10)
  if (age > FRESHNESS_DAYS) {
    logger.warn(
      `[check-pricing-data-is-current] model-pricing snapshot is ${age} days old (${iso}, window ${FRESHNESS_DAYS}d).`,
    )
    logger.warn(
      '  Fix: run the `researching-recency` skill (/researching-recency) on current model pricing, refresh the figures in docs/agents.md/fleet/skill-model-routing.md + the .claude/reports/ cost-ladder report, then bump the MODEL-PRICING-SNAPSHOT date.',
    )
    return
  }
  if (!quiet) {
    logger.success(
      `[check-pricing-data-is-current] model-pricing snapshot is current (${iso}, ${age}d old, window ${FRESHNESS_DAYS}d).`,
    )
  }
}

main()
