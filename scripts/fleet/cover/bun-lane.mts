/*
 * @file The bun coverage lane — the effectful half of the runner seam. Runs
 *   `bun test --coverage` with an lcov reporter, folds the result into the
 *   fleet's `AggregateCoverage`, persists the `coverage-summary.json` the badge
 *   pipeline reads, and applies the thresholds ITSELF.
 *   The fleet applies the thresholds rather than delegating to the runner
 *   because bun's own `coverageThreshold` silently ignores singular keys:
 *   `{ line = 0.99 }` parses without error and exits 0 at 50% coverage, while
 *   `{ lines = 0.99 }` exits 1. A gate a typo can disable is not a gate. Every
 *   pure decision this lane makes lives in ./runner.mts; this module only does
 *   the I/O.
 *   Acceptance property, the reason the lane exists: a coverage gate must never
 *   report success while measuring nothing. Three ways that is held —
 *
 *   1. A real run over measured files exits 0.
 *   2. A run that collected NOTHING exits 1, whether that is a missing lcov file,
 *      an empty one, or a zero line denominator.
 *   3. A threshold breach exits 1, aggregate or per-file.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  aggregateFromLcov,
  buildBunCoverageArgs,
  coverRunnerLimitations,
  lcovToIstanbulSummary,
  parseLcov,
  perFileThresholdFailures,
} from './runner.mts'
import type { LcovFileCoverage } from './runner.mts'
import type { CoverConfig } from './discovery.mts'
import type { AggregateCoverage } from '../util/coverage-merge.mts'

const logger = getDefaultLogger()

export interface BunLaneResult {
  aggregate: AggregateCoverage | undefined
  exitCode: number
  files: LcovFileCoverage[]
}

export interface BunLaneRunner {
  (args: string[]): Promise<{ exitCode: number }>
}

/**
 * The message for a run that measured nothing. This is the false-green the
 * whole lane exists to prevent, so it names what was missing rather than
 * reporting 0.00% and exiting 0.
 */
export function describeEmptyCollection(
  lcovPath: string,
  reason: 'empty' | 'missing' | 'no-lines',
): string {
  const saw = {
    empty: 'the lcov report exists but holds no file records',
    missing: 'no lcov report was written',
    'no-lines': 'the lcov report holds file records but zero measurable lines',
  }[reason]
  return [
    'Coverage collected nothing.',
    `  Where: ${lcovPath}`,
    `  Saw:   ${saw}; wanted at least one file with measurable lines.`,
    '  Fix:   check that the test run actually loaded the source under test —',
    '         a `coveragePathIgnorePatterns` that matches everything, a test',
    '         suite that imports nothing, or a failed run all land here. Run',
    '         the suite directly to see its output, then re-run coverage.',
  ].join('\n')
}

/**
 * Run the bun coverage lane end to end. `runner` is injected so a test drives
 * every branch — including the empty-collection and threshold-breach failures —
 * without spawning bun.
 */
export async function runBunCoverageLane(config: {
  configPath: string
  coverConfig: CoverConfig
  coverageDir: string
  passthroughArgs?: readonly string[] | undefined
  repoRoot: string
  runner: BunLaneRunner
  summaryPath: string
}): Promise<BunLaneResult> {
  const cfg = { __proto__: null, ...config } as typeof config

  // Refuse a configuration this runner cannot honor BEFORE running anything —
  // a gate that quietly measures less than it claims is worse than no gate.
  const limitations = coverRunnerLimitations(
    'bun',
    cfg.coverConfig,
    cfg.configPath,
  )
  if (limitations.length > 0) {
    for (let i = 0, { length } = limitations; i < length; i += 1) {
      logger.error(limitations[i]!)
    }
    return { aggregate: undefined, exitCode: 1, files: [] }
  }

  mkdirSync(cfg.coverageDir, { recursive: true })
  const lcovPath = path.join(cfg.coverageDir, 'lcov.info')
  const run = await cfg.runner(
    buildBunCoverageArgs({
      coverageDir: cfg.coverageDir,
      passthroughArgs: cfg.passthroughArgs,
    }),
  )
  let exitCode = run.exitCode

  if (!existsSync(lcovPath)) {
    logger.error(describeEmptyCollection(lcovPath, 'missing'))
    return {
      aggregate: undefined,
      exitCode: exitCode === 0 ? 1 : exitCode,
      files: [],
    }
  }
  const files = parseLcov(readFileSync(lcovPath, 'utf8'), cfg.repoRoot)
  if (files.length === 0) {
    logger.error(describeEmptyCollection(lcovPath, 'empty'))
    return {
      aggregate: undefined,
      exitCode: exitCode === 0 ? 1 : exitCode,
      files,
    }
  }
  const aggregate = aggregateFromLcov(files)
  if (aggregate.totalStatements === 0) {
    logger.error(describeEmptyCollection(lcovPath, 'no-lines'))
    return { aggregate, exitCode: exitCode === 0 ? 1 : exitCode, files }
  }

  // Persist the summary the badge pipeline reads, in the same istanbul shape
  // the vitest lane's merge writes, so the badge is runner-agnostic.
  mkdirSync(path.dirname(cfg.summaryPath), { recursive: true })
  writeFileSync(
    cfg.summaryPath,
    `${JSON.stringify(lcovToIstanbulSummary(files), undefined, 2)}\n`,
    'utf8',
  )

  const perFileFailures = perFileThresholdFailures(
    files,
    cfg.coverConfig.perFileThresholds,
  )
  if (perFileFailures.length > 0) {
    logger.error(`Per-file coverage below floor: ${perFileFailures.join(', ')}`)
    exitCode = exitCode === 0 ? 1 : exitCode
  }

  return { aggregate, exitCode, files }
}
