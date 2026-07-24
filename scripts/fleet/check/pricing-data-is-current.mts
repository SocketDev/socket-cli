#!/usr/bin/env node
/**
 * @file Staleness gate for the fleet's model-pricing data. The per-token list
 *   prices + plan structure in `scripts/fleet/constants/model-pricing.json`
 *   drive the AI cost estimator and model-tier routing, but vendor prices move
 *   often, so a stale snapshot silently misroutes spend. v2 pricing is
 *   per-service: each service stamps its own `snapshot`, so this check reports
 *   each service's age against a per-service freshness window and reminds
 *   (non-fatal) on the stale ones. A combined routing-doc marker (<!--
 *   MODEL-PRICING-SNAPSHOT: YYYY-MM-DD -- ... -->) is the fallback for a repo
 *   that carries the doc but not the JSON. "Code is law": the prose note alone
 *   ("re-verify if stale") is policy-on-paper; this turns it into an enforced
 *   reminder that surfaces in every `check --all` run, with the exact remedy
 *   (run /update-pricing — re-source the stale service from the vendor page or
 *   the researching-recency feed, restamp its snapshot). Reminds rather than
 *   hard-fails: stale pricing is advisory, not a correctness break, so blocking
 *   every commit fleet-wide the day a window lapses would be too aggressive.
 *   The reminder is loud (it prints in the check summary); the fix is one skill
 *   invocation. Fails open (exit 0, silent) when neither the JSON nor the doc
 *   marker is present — a repo without pricing data has nothing to keep fresh.
 *   Exit code: always 0. This surface reminds; it never blocks.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../_shared/is-main-module.mts'
import { loadPricing } from '../estimate-ai-cost.mts'
import { REPO_ROOT } from '../paths.mts'

import type { PricingData } from '../estimate-ai-cost.mts'

const logger = getDefaultLogger()

// Days after a snapshot before the data is considered stale. Derived from the
// weekly `updating` cadence that refreshes it (the `updating-pricing` sub-skill
// runs in the umbrella, `cron: 0 9 * * 1`): one week plus a few days of slack
// so a delayed or skipped weekly run doesn't nag immediately. Anchored to a
// real cadence, not a guessed window — if the weekly refresh runs, a snapshot
// is never older than ~7 days.
const FRESHNESS_DAYS = 10

// Per-service overrides: third-party metered/flat-rate providers rotate prices
// faster than the first-party vendor, so they age out sooner. Data, not code.
export const FRESHNESS_BY_SERVICE: Readonly<Record<string, number>> = {
  fireworks: 7,
  synthetic: 7,
}

const ROUTING_DOC = path.join(
  REPO_ROOT,
  'docs',
  'agents.md',
  'fleet',
  'skill-model-routing.md',
)

// `<!-- MODEL-PRICING-SNAPSHOT: 2026-06-11 -- ... -->`. Captures the ISO date.
const SNAPSHOT_RE = /MODEL-PRICING-SNAPSHOT:\s*(\d{4}-\d{2}-\d{2})\b/

// One stale service the check reports.
export interface StaleService {
  service: string
  snapshot: string
  age: number
  window: number
}

// Whole days between two dates (b - a), floored. Both are parsed as UTC
// midnight so DST / timezone never shifts the count.
export function daysBetween(a: Date, b: Date): number {
  const msPerDay = 86_400_000
  return Math.floor((b.getTime() - a.getTime()) / msPerDay)
}

// The freshness window for a service: its override, else the fleet default.
export function freshnessWindow(service: string): number {
  return FRESHNESS_BY_SERVICE[service] ?? FRESHNESS_DAYS
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

// The services whose snapshot is older than their freshness window. Pure given
// `now`. Skips a service with an unparseable snapshot (fails open per-service).
export function staleServices(pricing: PricingData, now: Date): StaleService[] {
  const stale: StaleService[] = []
  const services = pricing.services ?? {}
  const serviceNames = Object.keys(services)
  for (let i = 0, { length } = serviceNames; i < length; i += 1) {
    const service = serviceNames[i]!
    const snapshot = services[service]?.snapshot
    if (!snapshot) {
      continue
    }
    const parsed = new Date(`${snapshot}T00:00:00Z`)
    if (Number.isNaN(parsed.getTime())) {
      continue
    }
    const age = daysBetween(parsed, now)
    const window = freshnessWindow(service)
    if (age > window) {
      stale.push({ age, service, snapshot, window })
    }
  }
  return stale
}

// Fall back to the combined routing-doc marker (for a repo that carries the doc
// but not the JSON). Same behavior the v1 check had.
function checkDocMarker(quiet: boolean): void {
  if (!existsSync(ROUTING_DOC)) {
    return
  }
  const snapshot = parseSnapshotDate(readFileSync(ROUTING_DOC, 'utf8'))
  if (!snapshot) {
    return
  }
  const age = daysBetween(snapshot, new Date())
  const iso = snapshot.toISOString().slice(0, 10)
  if (age > FRESHNESS_DAYS) {
    logger.warn(
      `[check-pricing-data-is-current] model-pricing snapshot is ${age} days old (${iso}, window ${FRESHNESS_DAYS}d — the weekly updating cadence).`,
    )
    logger.warn(
      '  Fix: run /update-pricing (the updating-pricing sub-skill) — it re-sources prices and restamps the snapshot. (Or let the weekly /updating umbrella run it.)',
    )
    return
  }
  if (!quiet) {
    logger.success(
      `[check-pricing-data-is-current] model-pricing snapshot is current (${iso}, ${age}d old, window ${FRESHNESS_DAYS}d).`,
    )
  }
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  let pricing: PricingData | undefined
  try {
    pricing = loadPricing()
  } catch {
    // No JSON — fall back to the doc marker (repo may carry only the doc).
    pricing = undefined
  }
  if (!pricing?.services) {
    checkDocMarker(quiet)
    return
  }
  const stale = staleServices(pricing, new Date())
  if (stale.length) {
    for (const entry of stale) {
      logger.warn(
        `[check-pricing-data-is-current] ${entry.service} pricing snapshot is ${entry.age} days old (${entry.snapshot}, window ${entry.window}d).`,
      )
    }
    logger.warn(
      '  Fix: run /update-pricing (the updating-pricing sub-skill) — it re-sources the stale service(s) from the vendor page or the researching-recency feed and restamps their snapshot. (Or let the weekly /updating umbrella run it.)',
    )
    return
  }
  if (!quiet) {
    logger.success(
      `[check-pricing-data-is-current] all ${Object.keys(pricing.services).length} service pricing snapshots are current.`,
    )
  }
}

if (isMainModule(import.meta.url)) {
  void main()
}
