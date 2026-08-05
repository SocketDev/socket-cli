#!/usr/bin/env node
/*
 * @file Assert the Cover thresholds track measured coverage — the ratchet is
 *   law, not a manual habit.
 *
 *   New features ship fully covered, so measured coverage climbs; a threshold
 *   left behind lets the NEXT uncovered feature burn that margin silently and
 *   the repo loses ground with a green gate. This check closes the loop: when
 *   any measured metric in the last cover run exceeds its committed threshold
 *   by more than the ratchet band, the threshold is stale and the check fails
 *   naming the gap. `--fix` writes the ratcheted values (one point under the
 *   measured floor). A threshold NEVER moves down — same one-way discipline as
 *   socket-pins-are-never-lowered; a genuine coverage regression fails the
 *   Cover gate itself, never this check.
 *
 *   Fail-open skips: no coverage summary on this tree (no cover run yet), or a
 *   repo with no cover thresholds configured (report-only coverage).
 *
 *   Exit: 0 ratcheted or not checkable; 1 at least one stale threshold.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'
import { COVERAGE_SUMMARY_PATH, findSocketWheelhouseConfig } from '../paths.mts'

const logger = getDefaultLogger()

// Headroom a measured metric may hold above its threshold before the ratchet
// is stale. Wide enough that run-to-run jitter (local-vs-CI drift runs well
// under half a point) never nags; narrow enough that a landed feature burst
// cannot hide. The `--fix` margin below stays inside this band, so a freshly
// ratcheted repo is always green here.
export const RATCHET_BAND = 1.5

// What `--fix` leaves between the new threshold and the measured floor, the
// campaign convention: floor(measured) - 1 absorbs CI variance.
export const FIX_MARGIN = 1

export const METRICS = ['branches', 'functions', 'lines', 'statements'] as const

export type MetricName = (typeof METRICS)[number]

export type StaleThreshold = {
  metric: MetricName
  measured: number
  threshold: number
  ratcheted: number
}

/**
 * The measured aggregate percentages from a cover run's summary JSON, or
 * `undefined` when the payload has no readable `total` block.
 */
export function readMeasuredTotals(
  summaryText: string,
): Partial<Record<MetricName, number>> | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(summaryText)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined
  }
  const total = (parsed as Record<string, unknown>)['total']
  if (typeof total !== 'object' || total === null) {
    return undefined
  }
  const out: Partial<Record<MetricName, number>> = {}
  for (let i = 0, { length } = METRICS; i < length; i += 1) {
    const metric = METRICS[i]!
    const entry = (total as Record<string, unknown>)[metric]
    if (typeof entry !== 'object' || entry === null) {
      continue
    }
    const pct = (entry as Record<string, unknown>)['pct']
    if (typeof pct === 'number' && Number.isFinite(pct)) {
      out[metric] = pct
    }
  }
  return out
}

/**
 * The committed `cover.thresholds` block from a socket-wheelhouse.json
 * payload, or `undefined` when the repo configures none (report-only).
 */
export function readConfiguredThresholds(
  configText: string,
): Partial<Record<MetricName, number>> | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(configText)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined
  }
  const cover = (parsed as Record<string, unknown>)['cover']
  if (typeof cover !== 'object' || cover === null) {
    return undefined
  }
  const thresholds = (cover as Record<string, unknown>)['thresholds']
  if (typeof thresholds !== 'object' || thresholds === null) {
    return undefined
  }
  const out: Partial<Record<MetricName, number>> = {}
  for (let i = 0, { length } = METRICS; i < length; i += 1) {
    const metric = METRICS[i]!
    const value = (thresholds as Record<string, unknown>)[metric]
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[metric] = value
    }
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * Every metric whose measured value has outrun its committed threshold by
 * more than the ratchet band, with the value `--fix` would write. A ratchet
 * never lowers: a measured value below the threshold is the Cover gate's
 * problem and reports nothing here.
 */
export function staleThresholds(
  measured: Partial<Record<MetricName, number>>,
  thresholds: Partial<Record<MetricName, number>>,
): StaleThreshold[] {
  const out: StaleThreshold[] = []
  for (let i = 0, { length } = METRICS; i < length; i += 1) {
    const metric = METRICS[i]!
    const pct = measured[metric]
    const threshold = thresholds[metric]
    if (pct === undefined || threshold === undefined) {
      continue
    }
    const ratcheted = Math.max(threshold, Math.floor(pct) - FIX_MARGIN)
    if (pct - threshold > RATCHET_BAND && ratcheted > threshold) {
      out.push({ metric, measured: pct, ratcheted, threshold })
    }
  }
  return out
}

/**
 * Rewrite each stale `"<metric>": <n>` inside the config's `thresholds` block
 * with its ratcheted value, preserving every other byte of the file. Returns
 * the updated text, or `undefined` when a metric line cannot be located (the
 * caller fails loud rather than writing a partial ratchet).
 */
export function ratchetConfigText(
  configText: string,
  stale: readonly StaleThreshold[],
): string | undefined {
  let next = configText
  for (let i = 0, { length } = stale; i < length; i += 1) {
    const entry = stale[i]!
    const re = new RegExp(`("${entry.metric}"\\s*:\\s*)${entry.threshold}\\b`)
    if (!re.test(next)) {
      return undefined
    }
    next = next.replace(re, `$1${entry.ratcheted}`)
  }
  return next
}

export async function main(): Promise<void> {
  const fix = process.argv.includes('--fix')
  if (!existsSync(COVERAGE_SUMMARY_PATH)) {
    // No cover run on this tree — the ratchet has nothing to compare against.
    return
  }
  const measured = readMeasuredTotals(
    readFileSync(COVERAGE_SUMMARY_PATH, 'utf8'),
  )
  if (!measured) {
    return
  }
  const location = findSocketWheelhouseConfig()
  if (!location) {
    return
  }
  const configText = readFileSync(location.path, 'utf8')
  const thresholds = readConfiguredThresholds(configText)
  if (!thresholds) {
    // Report-only repo — no gate to ratchet.
    return
  }
  const stale = staleThresholds(measured, thresholds)
  if (!stale.length) {
    logger.success(
      '[coverage-thresholds-are-ratcheted] every Cover threshold tracks the measured coverage.',
    )
    return
  }
  if (fix) {
    const next = ratchetConfigText(configText, stale)
    if (next === undefined) {
      logger.fail(
        '[coverage-thresholds-are-ratcheted] could not locate a threshold line to rewrite.\n' +
          `  Where: ${location.path} cover.thresholds.\n` +
          '  Saw:   a stale metric whose literal value is not in the file.\n' +
          '  Fix:   ratchet the block by hand to the values reported above.',
      )
      process.exitCode = 1
      return
    }
    writeFileSync(location.path, next)
    for (let i = 0, { length } = stale; i < length; i += 1) {
      const entry = stale[i]!
      logger.success(
        `[coverage-thresholds-are-ratcheted] ${entry.metric}: ${entry.threshold} -> ${entry.ratcheted} (measured ${entry.measured.toFixed(2)}).`,
      )
    }
    return
  }
  for (let i = 0, { length } = stale; i < length; i += 1) {
    const entry = stale[i]!
    logger.fail(
      `[coverage-thresholds-are-ratcheted] ${entry.metric} threshold is stale: measured ${entry.measured.toFixed(2)} vs committed ${entry.threshold} (band ${RATCHET_BAND}).`,
    )
  }
  logger.error(
    '  Covered features raised the measurement; lock the gains so the next\n' +
      '  uncovered change cannot burn the margin silently. Fix: run\n' +
      '  `node scripts/fleet/check/coverage-thresholds-are-ratcheted.mts --fix`\n' +
      '  and commit the ratcheted thresholds.',
  )
  process.exitCode = 1
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks the Cover thresholds are ratcheted up to the measured coverage — gains lock, ground is never lost',
  help: `Usage: node scripts/fleet/check/coverage-thresholds-are-ratcheted.mts [--fix]`,
}

/* c8 ignore start - entrypoint guard; only runs when node executes this file as the process entry, never under the in-process test runner */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
