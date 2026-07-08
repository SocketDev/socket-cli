#!/usr/bin/env node
/**
 * @file Feed-sourcing fallback for the `updating-pricing` sub-skill. The primary
 *   path reads a provider's prices straight off its vendor pricing page
 *   (WebFetch the service's `pricingSource`). When a number isn't directly
 *   available — the page moved, is gated, or a price just changed and the doc
 *   lags — this script mines the `researching-recency` multi-source feed
 *   (web / hackernews / lobsters / reddit) for recent pricing announcements for
 *   one service, and prints the engine's compact evidence envelope. The SKILL
 *   (the agentic half) reads that envelope, extracts the current per-token
 *   prices, and hands them to `scripts/fleet/update-model-pricing.mts` which
 *   owns the canonical write. This script does the DETERMINISTIC half only:
 *   build a service-tuned query plan (pure, testable) and run the feed engine.
 *   It makes no AI calls itself — the extraction judgment lives in the skill,
 *   where a fetch-failure is surfaced rather than a price guessed. Usage: node
 *   scripts/fleet/source-pricing-feed.mts --service anthropic [--depth deep]
 *   [--days 120].
 */

import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { loadPricing } from './estimate-ai-cost.mts'
import { run } from './researching-recency/cli.mts'

import type { ServiceEntry } from './estimate-ai-cost.mts'
import type { QueryPlan } from './researching-recency/lib/types.mts'

const logger = getDefaultLogger()

// Build a pricing-tuned researching-recency plan for one service. Pure: the same
// service entry always yields the same plan, so it is unit-tested without the
// network. Labels are slugs (no spaces — they key the fusion streams). Sources
// are keyless so the plan runs without per-source credentials.
export function buildPricingPlan(
  serviceId: string,
  service: ServiceEntry,
): QueryPlan {
  const name = service.displayName
  return {
    freshnessMode: 'balancedRecent',
    intent: 'overview',
    notes: [
      `Sourcing current per-token list prices for ${serviceId} (${name}).`,
      `Cross-check against the vendor pricing page: ${service.pricingSource}.`,
      'Extract input/output USD per million tokens per model; do not guess.',
    ],
    rawTopic: `${name} API token pricing`,
    sourceWeights: {},
    subqueries: [
      {
        label: 'list-prices',
        rankingQuery: `${name} API pricing per million tokens`,
        searchQuery: `${name} API pricing per million tokens input output`,
        sources: ['web', 'hackernews', 'lobsters'],
        weight: 1,
      },
      {
        label: 'price-change',
        rankingQuery: `${name} price change`,
        searchQuery: `${name} API price change announcement 2026`,
        sources: ['web', 'hackernews', 'reddit'],
        weight: 0.8,
      },
    ],
  }
}

function flag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name)
  return i !== -1 ? argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const serviceId = flag(argv, '--service') ?? 'anthropic'
  const pricing = loadPricing()
  const service = pricing.services?.[serviceId]
  if (!service) {
    const known = Object.keys(pricing.services ?? {}).join(', ')
    logger.fail(
      `unknown service "${serviceId}". Known: ${known}. ` +
        'Pass --service <id> matching a service in model-pricing.json.',
    )
    process.exitCode = 1
    return
  }
  const plan = buildPricingPlan(serviceId, service)
  const envelope = await run([
    plan.rawTopic,
    '--plan',
    JSON.stringify(plan),
    '--depth',
    flag(argv, '--depth') ?? 'default',
    '--days',
    flag(argv, '--days') ?? '120',
    '--emit',
    'compact',
  ])
  logger.log(envelope)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void (async () => {
    try {
      await main()
    } catch (e) {
      logger.error(`source-pricing-feed failed: ${errorMessage(e)}`)
      process.exitCode = 1
    }
  })()
}
