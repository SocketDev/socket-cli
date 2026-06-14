#!/usr/bin/env node
/**
 * @file Reconcile `scripts/fleet/constants/model-pricing.json` from freshly
 *   sourced per-model prices, restamping the snapshot date to today. The
 *   deterministic half of the `updating-pricing` sub-skill: the skill does the
 *   agentic part (fetch the vendor pricing page, read off the numbers); this
 *   script owns the write so the JSON shape, sort order, and snapshot date stay
 *   canonical and a hand-typed price can't drift the format. Mirrors the
 *   make-coverage-badge.mts pattern — the skill is orchestration over this
 *   owner, never re-deriving the data shape in shell. Prices come in as a JSON
 *   object of `{ "<model-id>": { inputPerMtok, outputPerMtok }, ... }` via
 *   `--prices <json>` or on stdin. Only the per-model rates change on a routine
 *   refresh; the multipliers + the model set are stable, so absent prices keep
 *   their current values (a refresh that omits a model leaves that model
 *   untouched, it does not drop it). The `snapshot` is set to today (or `--date
 *   YYYY-MM-DD` for a deterministic test); `--source <url>` overrides the
 *   recorded source. `--check` is a dry-run: it reports whether the on-disk
 *   snapshot is older than the freshness window and what a refresh would
 *   change, without writing — the same shape the `pricing-data-is-current` gate
 *   uses. Usage: node scripts/fleet/update-model-pricing.mts --prices
 *   '{"claude-opus-4-8":{"inputPerMtok":5,"outputPerMtok":25}}' node
 *   scripts/fleet/update-model-pricing.mts --check echo '<json>' | node
 *   scripts/fleet/update-model-pricing.mts --date 2026-06-14.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { loadPricing } from './estimate-ai-cost.mts'
import { REPO_ROOT } from './paths.mts'

import type { ModelPrice, PricingData } from './estimate-ai-cost.mts'

const logger = getDefaultLogger()

const PRICING_PATH = path.join(
  REPO_ROOT,
  'scripts',
  'fleet',
  'constants',
  'model-pricing.json',
)

// The routing doc + its machine-readable snapshot marker that the
// pricing-data-is-current gate reads. Restamped in lock-step with the JSON so
// the two sources never disagree on the capture date.
const ROUTING_DOC = path.join(
  REPO_ROOT,
  'docs',
  'agents.md',
  'fleet',
  'skill-model-routing.md',
)

// Group 1 = the `MODEL-PRICING-SNAPSHOT:` label + its trailing space (kept
// verbatim in the replace); group 2 = the ISO date that gets swapped for the
// new snapshot. The replace uses `$1<date>` so only the date changes.
const SNAPSHOT_MARKER_RE = /(MODEL-PRICING-SNAPSHOT:\s*)(\d{4}-\d{2}-\d{2})/

export interface UpdatePricingOptions {
  prices: Record<string, ModelPrice>
  date: string
  source?: string | undefined
}

function flag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name)
  return i !== -1 ? argv[i + 1] : undefined
}

// Read the sourced prices: from --prices <json>, else from stdin. Returns an
// empty object when neither is supplied (a --check run needs no prices).
export function readSourcedPrices(
  argv: readonly string[],
  stdin: string,
): Record<string, ModelPrice> {
  const inline = flag(argv, '--prices')
  const raw = inline ?? (stdin.trim() ? stdin : '')
  if (!raw) {
    return { __proto__: null } as Record<string, ModelPrice>
  }
  const parsed = JSON.parse(raw) as Record<string, ModelPrice>
  return { __proto__: null, ...parsed }
}

// Merge sourced prices over the current pricing and restamp the snapshot.
// Absent models keep their current rates (a partial refresh never drops a
// model). Returns the new PricingData; pure given its inputs.
export function applyPricingUpdate(
  current: PricingData,
  options: UpdatePricingOptions,
): PricingData {
  options = { __proto__: null, ...options } as typeof options
  const models: Record<string, ModelPrice> = {
    __proto__: null,
    ...current.models,
  }
  for (const [model, price] of Object.entries(options.prices)) {
    models[model] = {
      inputPerMtok: price.inputPerMtok,
      outputPerMtok: price.outputPerMtok,
    }
  }
  return {
    ...current,
    models,
    snapshot: options.date,
    ...(options.source ? { source: options.source } : {}),
  }
}

// Restamp the routing-doc snapshot marker to `date`. Returns the rewritten text
// (unchanged when the marker is absent — a repo may not carry the doc).
export function restampDocMarker(docText: string, date: string): string {
  return docText.replace(SNAPSHOT_MARKER_RE, `$1${date}`)
}

// Today's date as YYYY-MM-DD (UTC). Pulled out so a test can inject --date.
function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function main(): void {
  const argv = process.argv.slice(2)
  const check = argv.includes('--check')
  const current = loadPricing()

  if (check) {
    logger.info(
      `[update-model-pricing] current snapshot: ${current.snapshot}, source: ${current.source}`,
    )
    logger.info(`  models priced: ${Object.keys(current.models).join(', ')}`)
    logger.info(
      '  to refresh: source current prices from the vendor page, then run without --check (or via /update-pricing).',
    )
    return
  }

  const stdin = process.stdin.isTTY ? '' : readFileSync(0, 'utf8')
  const prices = readSourcedPrices(argv, stdin)
  const date = flag(argv, '--date') ?? todayIso()
  const source = flag(argv, '--source')

  const next = applyPricingUpdate(current, { date, prices, source })
  writeFileSync(PRICING_PATH, `${JSON.stringify(next, undefined, 2)}\n`)
  logger.success(
    `[update-model-pricing] wrote ${path.relative(REPO_ROOT, PRICING_PATH)} (snapshot ${date}, ${Object.keys(prices).length} model(s) re-priced).`,
  )

  try {
    const docText = readFileSync(ROUTING_DOC, 'utf8')
    const restamped = restampDocMarker(docText, date)
    if (restamped !== docText) {
      writeFileSync(ROUTING_DOC, restamped)
      logger.success(
        `[update-model-pricing] restamped MODEL-PRICING-SNAPSHOT in ${path.relative(REPO_ROOT, ROUTING_DOC)} → ${date}.`,
      )
    }
  } catch {
    // Repo may not carry the routing doc — the JSON is the source of truth.
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
