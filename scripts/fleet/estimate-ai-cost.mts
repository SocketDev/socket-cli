#!/usr/bin/env node
/**
 * @file Estimate the USD cost of an AI agent run from its model + token
 *   profile, using the sourced + timestamped pricing data in
 *   `scripts/fleet/constants/model-pricing.json`. Replaces guessed budget
 *   ceilings (e.g. a round `max-ai-credits`) with a figure derived from real
 *   vendor prices. Cost model (per the vendor pricing page): usd =
 *   inputTokens/1e6 * inputPerMtok + outputTokens/1e6 * outputPerMtok with
 *   optional multipliers: --batch (0.5x both), and a cache-read fraction
 *   (cacheReadTokens billed at 0.1x input instead of 1x). Token profile: pass
 *   real counts with --input/--output, OR a named workload from
 *   WORKLOAD_PROFILES (rough, documented estimates — refine from real `gh aw
 *   logs` token data as runs accrue). Effort scales the OUTPUT side of a
 *   profile (higher reasoning effort → more output/thinking tokens). Pricing
 *   freshness is NOT gated by an arbitrary day-count here: the
 *   `updating-pricing` sub-skill refreshes the data on the weekly `/updating`
 *   cadence (and on demand). This tool just PRINTS the snapshot age + source so
 *   staleness is visible. Usage: node scripts/fleet/estimate-ai-cost.mts
 *   --model claude-haiku-4-5 --input 60000 --output 8000 node
 *   scripts/fleet/estimate-ai-cost.mts --model claude-haiku-4-5 --workload
 *   weekly-update [--effort high] node scripts/fleet/estimate-ai-cost.mts
 *   --workload weekly-update --json.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from './paths.mts'

const logger = getDefaultLogger()

const PRICING_PATH = path.join(
  REPO_ROOT,
  'scripts',
  'fleet',
  'constants',
  'model-pricing.json',
)

export interface ModelPrice {
  inputPerMtok: number
  outputPerMtok: number
}

export interface PricingData {
  snapshot: string
  source: string
  multipliers: { batch: number; cacheRead: number }
  models: Record<string, ModelPrice>
}

// Rough per-workload token profiles. These are ESTIMATES (flagged as such):
// seed values to be replaced with measured profiles from `gh aw logs` as real
// runs accrue. Effort scales `output` (the reasoning/thinking side).
export const WORKLOAD_PROFILES: Readonly<
  Record<string, { input: number; output: number }>
> = {
  // A test-failure fix (heavier: read logs + iterate). Sized above weekly.
  'fix-test-failures': { input: 120_000, output: 25_000 },
  // A weekly dependency update: read manifests/lockfile + the /updating skill's
  // tool turns, modest output. Conservative seed until logs refine it.
  'weekly-update': { input: 80_000, output: 12_000 },
}

// Effort → output-token multiplier. Higher reasoning effort emits more
// thinking/output tokens; input is roughly fixed. Directional, not measured.
export const EFFORT_OUTPUT_MULTIPLIER: Readonly<Record<string, number>> = {
  high: 1.6,
  low: 0.6,
  medium: 1.0,
  xhigh: 2.4,
}

export interface EstimateInput {
  model: string
  inputTokens: number
  outputTokens: number
  batch?: boolean | undefined
  cacheReadTokens?: number | undefined
}

export interface EstimateResult {
  usd: number
  inputUsd: number
  outputUsd: number
  model: string
  inputTokens: number
  outputTokens: number
}

export function loadPricing(): PricingData {
  if (!existsSync(PRICING_PATH)) {
    throw new Error(
      `model-pricing.json not found at ${PRICING_PATH}. ` +
        'Run the updating-pricing sub-skill (or /updating) to source it.',
    )
  }
  return JSON.parse(readFileSync(PRICING_PATH, 'utf8')) as PricingData
}

// Whole-days between an ISO date string and now. Pure given `now`.
export function daysOld(snapshotIso: string, now: Date): number {
  const then = new Date(`${snapshotIso}T00:00:00Z`).getTime()
  return Math.floor((now.getTime() - then) / 86_400_000)
}

// Compute the USD cost for a model + token counts against the pricing data.
export function estimateCost(
  pricing: PricingData,
  input: EstimateInput,
): EstimateResult {
  const price = pricing.models[input.model]
  if (!price) {
    const known = Object.keys(pricing.models).join(', ')
    throw new Error(
      `unknown model "${input.model}". Known: ${known}. ` +
        'Add it to model-pricing.json (re-sourced from the vendor page).',
    )
  }
  const batchMult = input.batch ? pricing.multipliers.batch : 1
  const cacheRead = input.cacheReadTokens ?? 0
  // Cached input tokens bill at the cache-read fraction; the rest at full input.
  const fullInput = Math.max(0, input.inputTokens - cacheRead)
  const inputUsd =
    ((fullInput * price.inputPerMtok +
      cacheRead * price.inputPerMtok * pricing.multipliers.cacheRead) /
      1_000_000) *
    batchMult
  const outputUsd =
    ((input.outputTokens * price.outputPerMtok) / 1_000_000) * batchMult
  return {
    inputTokens: input.inputTokens,
    inputUsd,
    model: input.model,
    outputTokens: input.outputTokens,
    outputUsd,
    usd: inputUsd + outputUsd,
  }
}

function flag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name)
  return i !== -1 ? argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const pricing = loadPricing()
  const model = flag(argv, '--model') ?? 'claude-haiku-4-5'

  let inputTokens: number
  let outputTokens: number
  const workload = flag(argv, '--workload')
  if (workload) {
    const profile = WORKLOAD_PROFILES[workload]
    if (!profile) {
      logger.fail(
        `unknown workload "${workload}". Known: ${Object.keys(WORKLOAD_PROFILES).join(', ')}.`,
      )
      process.exitCode = 1
      return
    }
    const effort = flag(argv, '--effort') ?? 'medium'
    const effortMult = EFFORT_OUTPUT_MULTIPLIER[effort] ?? 1
    inputTokens = profile.input
    outputTokens = Math.round(profile.output * effortMult)
  } else {
    inputTokens = Number(flag(argv, '--input') ?? 0)
    outputTokens = Number(flag(argv, '--output') ?? 0)
  }

  const result = estimateCost(pricing, {
    batch: argv.includes('--batch'),
    cacheReadTokens: Number(flag(argv, '--cache-read') ?? 0) || undefined,
    inputTokens,
    model,
    outputTokens,
  })
  const age = daysOld(pricing.snapshot, new Date())

  if (argv.includes('--json')) {
    process.stdout.write(
      `${JSON.stringify({ ...result, pricingSnapshot: pricing.snapshot, pricingAgeDays: age, source: pricing.source }, undefined, 2)}\n`,
    )
    return
  }

  logger.info(`[estimate-ai-cost] model: ${result.model}`)
  logger.info(
    `  tokens: ${result.inputTokens.toLocaleString()} in / ${result.outputTokens.toLocaleString()} out`,
  )
  logger.info(
    `  cost:   $${result.usd.toFixed(4)} ($${result.inputUsd.toFixed(4)} in + $${result.outputUsd.toFixed(4)} out)`,
  )
  logger.info(
    `  pricing: snapshot ${pricing.snapshot} (${age}d old), source ${pricing.source}`,
  )
  if (workload) {
    logger.info(
      '  note: token counts are an ESTIMATE from WORKLOAD_PROFILES — refine from real `gh aw logs`.',
    )
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main()
}
