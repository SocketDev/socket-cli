#!/usr/bin/env node
/**
 * @file Reconcile `scripts/fleet/constants/model-pricing.json` from freshly
 *   sourced per-model prices, restamping the chosen service's snapshot to
 *   today. The deterministic half of the `updating-pricing` sub-skill: the
 *   skill does the agentic part (fetch the vendor pricing page, or mine the
 *   researching-recency feed when a number isn't directly available, then read
 *   off the numbers); this script owns the write so the JSON shape, sort order,
 *   and snapshot date stay canonical and a hand-typed price can't drift the
 *   format. Mirrors the gen/coverage-badge.mts pattern — the skill is
 *   orchestration over this owner, never re-deriving the data shape in shell.
 *   Prices come in as a JSON object of `{ "<model-id>": { inputPerMtok,
 *   outputPerMtok }, ... }` via `--prices <json>` or on stdin, and merge into
 *   one service chosen with `--service <id>` (default `anthropic`). Pricing is
 *   per-service in v2: each service stamps its own snapshot, so a refresh
 *   restamps only the targeted service. Only the per-model rates change on a
 *   routine refresh; the multipliers + the model set are stable, so absent
 *   prices keep their current values (a refresh that omits a model leaves that
 *   model untouched, it does not drop it; an existing model's other fields —
 *   contextWindow, billing, suspended — are preserved). The service `snapshot`
 *   is set to today (or `--date YYYY-MM-DD` for a deterministic test);
 *   `--source <url>` overrides that service's `pricingSource`. The combined
 *   routing-doc `MODEL-PRICING-SNAPSHOT` marker is a single freshness anchor
 *   restamped to the same date (the per-service snapshots in the JSON are the
 *   precise per-provider dates). `--check` is a dry-run: it reports each
 *   service's on-disk snapshot + priced models without writing. `--replace`
 *   rewrites the chosen service's `models` block wholesale (the migration path
 *   for renaming / pruning model ids — a merge can't drop a key) and `--aliases
 *   <json>` replaces that service's routing-alias map. WHEELHOUSE-AWARE: when a
 *   `template/base/` tree exists, the canonical pricing JSON + routing doc
 *   under it are read + written — not the cascade-generated live copy, which a
 *   dogfood cascade would otherwise revert; a member writes its own live tree.
 *   Usage: node scripts/fleet/update-model-pricing.mts --service anthropic
 *   --prices '{"claude-opus-4-8":{"inputPerMtok":5,"outputPerMtok":25}}' node
 *   scripts/fleet/update-model-pricing.mts --check echo '<json>' | node
 *   scripts/fleet/update-model-pricing.mts --service fireworks --date
 *   2026-06-14.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from './paths.mts'

import type { ModelPrice, PricingData } from './estimate-ai-cost.mts'
import { isMainModule } from './_shared/is-main-module.mts'

const logger = getDefaultLogger()

/**
 * The directory holding the CANONICAL pricing file. In the wheelhouse that is
 * `template/base/` — its live tree is cascade-generated, so a reconcile written
 * to live would be reverted by the next dogfood cascade. A member has no
 * `template/base/`, so it writes its own live tree. Resolving the base here is
 * what keeps a wheelhouse reconcile on the canonical copy.
 */
export function canonicalBaseDir(): string {
  const templateBase = path.join(REPO_ROOT, 'template', 'base')
  return existsSync(templateBase) ? templateBase : REPO_ROOT
}

function pricingPath(): string {
  return path.join(
    canonicalBaseDir(),
    'scripts',
    'fleet',
    'constants',
    'model-pricing.json',
  )
}

// The routing doc + its machine-readable snapshot marker that the
// pricing-data-is-current gate reads. Restamped in lock-step with the JSON so
// the two sources never disagree on the capture date.
function routingDoc(): string {
  return path.join(
    canonicalBaseDir(),
    'docs',
    'agents.md',
    'fleet',
    'skill-model-routing.md',
  )
}

// Group 1 = the `MODEL-PRICING-SNAPSHOT:` label + its trailing space (kept
// verbatim in the replace); group 2 = the ISO date that gets swapped for the
// new snapshot. The replace uses `$1<date>` so only the date changes.
const SNAPSHOT_MARKER_RE = /(MODEL-PRICING-SNAPSHOT:\s*)(\d{4}-\d{2}-\d{2})/

export interface UpdatePricingConfig {
  // Which service's models the sourced prices merge into (e.g. 'anthropic').
  service: string
  prices: Record<string, ModelPrice>
  date: string
  source?: string | undefined
  // `--replace`: the provided `prices` REPLACE the service's `models` block
  // wholesale (each value used as-is, not merged onto an existing key) — the
  // migration path for renaming/pruning model ids, which a merge can't express.
  replace?: boolean | undefined
  // `--aliases`: when present, REPLACE the service's `aliases` map (routing
  // shortcuts like `syn:large:text`). Aliases aren't price-shaped, so they ride
  // their own option rather than `prices`.
  aliases?: Record<string, string> | undefined
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
    return { __proto__: null } as unknown as Record<string, ModelPrice>
  }
  const parsed = JSON.parse(raw) as Record<string, ModelPrice>
  return { __proto__: null, ...parsed } as unknown as typeof parsed
}

// Merge sourced prices over one service's models and restamp that service's
// snapshot. Absent models keep their current rates, and an updated model keeps
// its other fields (contextWindow / billing / suspended) — a partial refresh
// never drops a model or loses metadata. Throws on an unknown --service.
// Returns the new PricingData; pure given its inputs.
export function applyPricingUpdate(
  current: PricingData,
  config: UpdatePricingConfig,
): PricingData {
  config = { __proto__: null, ...config } as typeof config
  const services = {
    __proto__: null,
    ...current.services,
  } as unknown as typeof current.services
  const target = services[config.service]
  if (!target) {
    const known = Object.keys(current.services ?? {}).join(', ')
    throw new Error(
      `unknown service "${config.service}". Known: ${known}. ` +
        'Pass --service <id> matching a service in model-pricing.json.',
    )
  }
  // --replace starts from an empty block (rename/prune migration); a normal
  // refresh starts from the current models and merges over them.
  const models: Record<string, ModelPrice> = config.replace
    ? ({ __proto__: null } as unknown as Record<string, ModelPrice>)
    : ({ __proto__: null, ...target.models } as unknown as Record<
        string,
        ModelPrice
      >)
  for (const [model, price] of Object.entries(config.prices)) {
    models[model] = config.replace
      ? ({ ...price } as ModelPrice)
      : ({ ...models[model], ...price } as ModelPrice)
  }
  services[config.service] = {
    ...target,
    models,
    snapshot: config.date,
    ...(config.aliases !== undefined ? { aliases: config.aliases } : {}),
    ...(config.source ? { pricingSource: config.source } : {}),
  }
  return { ...current, services }
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
  const current = JSON.parse(readFileSync(pricingPath(), 'utf8')) as PricingData

  if (check) {
    logger.info('[update-model-pricing] current per-service snapshots:')
    const serviceIds = Object.keys(current.services ?? {})
    for (let i = 0, { length } = serviceIds; i < length; i += 1) {
      const serviceId = serviceIds[i]!
      const svc = current.services[serviceId]!
      logger.info(
        `  ${serviceId}: snapshot ${svc.snapshot}, source ${svc.pricingSource}`,
      )
      logger.info(`    models: ${Object.keys(svc.models).join(', ')}`)
    }
    logger.info(
      '  to refresh: source current prices for one service, then run without --check (--service <id> --prices <json>), or via /update-pricing.',
    )
    return
  }

  const stdin = process.stdin.isTTY ? '' : readFileSync(0, 'utf8')
  const prices = readSourcedPrices(argv, stdin)
  const date = flag(argv, '--date') ?? todayIso()
  const service = flag(argv, '--service') ?? 'anthropic'
  const source = flag(argv, '--source')
  const replace = argv.includes('--replace')
  const aliasesRaw = flag(argv, '--aliases')
  const aliases = aliasesRaw
    ? (JSON.parse(aliasesRaw) as Record<string, string>)
    : undefined

  const next = applyPricingUpdate(current, {
    aliases,
    date,
    prices,
    replace,
    service,
    source,
  })
  const outPath = pricingPath()
  writeFileSync(outPath, `${JSON.stringify(next, undefined, 2)}\n`)
  logger.success(
    `[update-model-pricing] wrote ${path.relative(REPO_ROOT, outPath)} (service ${service}, snapshot ${date}, ${Object.keys(prices).length} model(s) ${replace ? 'set (replace)' : 're-priced'}).`,
  )

  try {
    const docPath = routingDoc()
    const docText = readFileSync(docPath, 'utf8')
    const restamped = restampDocMarker(docText, date)
    if (restamped !== docText) {
      writeFileSync(docPath, restamped)
      logger.success(
        `[update-model-pricing] restamped MODEL-PRICING-SNAPSHOT in ${path.relative(REPO_ROOT, docPath)} → ${date}.`,
      )
    }
  } catch {
    // Repo may not carry the routing doc — the JSON is the source of truth.
  }
}

if (isMainModule(import.meta.url)) {
  main()
}
