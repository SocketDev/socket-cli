#!/usr/bin/env node
/**
 * @file Coverage runner — builds with source maps, runs vitest with coverage,
 *   masks test output, and prints a coverage summary. Runs the main suite and,
 *   when the repo ships one, an isolated suite (forks, full isolation for tests
 *   that mock globals / chdir / mutate process.env); the two coverage reports
 *   are merged with a max-hit-count strategy. Byte-identical across every fleet
 *   repo (sync-scaffolding flags drift). Config discovery is repo-first:
 *   `.config/repo/vitest.config.mts` then legacy `.config/vitest.config.mts`;
 *   the isolated suite runs only when `.config/repo/vitest.config.isolated.mts`
 *   (or the legacy `.config/` location) exists. Options: --code-only run only
 *   code coverage (skip type coverage); --type-only run only type coverage;
 *   --summary hide the detailed v8 table, show only the summary.
 */

import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { printHeader } from '@socketsecurity/lib-stable/stdio/header'

import {
  registerActiveRun,
  unregisterActiveRun,
} from './_shared/active-run-marker.mts'
import { isMainModule } from './_shared/is-main-module.mts'

import type { CoverThresholds } from './cover/discovery.mts'
import {
  buildChildrenCoverageReport,
  buildWithSourceMaps,
  captureEnvSnapshot,
  collectChurnNotes,
  collectLiveActorNotes,
  executeTestSuites,
  reexecWithHeapHeadroom,
  resolveRunPlan,
  runQuietCommand,
} from './cover-run.mts'
import {
  armUnitBudgetWatchdog,
  buildSuiteFailureReport,
  cleanOutputText,
  computeThresholdFailures,
  evaluateBudgetOverrun,
  parseTypeCoveragePercentValue,
  renderCodeCoverageDisplay,
  resolveConfiguredUnitBudgetMs,
} from './cover-report.mts'
import { ensurePinnedNode } from './lib/ensure-node.mts'
import { REPO_ROOT } from './paths.mts'
import type { AggregateCoverage } from './util/coverage-merge.mts'
import {
  mergeCoverageFinal,
  MissingTierCoverageError,
} from './util/coverage-merge.mts'

const rootPath = REPO_ROOT

const logger = getDefaultLogger()

export interface SuiteResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface TestSuitesResult {
  combined: SuiteResult
  isolatedResult: SuiteResult | undefined
  mainResult: SuiteResult
}

// Five coverage baselines were corrupted by concurrent activity before the
// evidence trail existed: a parallel session's live edits mid-run (73
// phantom failures), a mid-run pnpm install that transiently gutted module
// resolution (235 phantom import errors), and load-starved child spawns.
// The churn-evidence helpers below make that churn VISIBLE: announce live
// foreign actors at startup, snapshot the install state, and stamp any
// failure with what changed during the run — a poisoned baseline names its
// poisoner instead of reading as 20+ regressions.
export interface EnvSnapshot {
  readonly lockfileMtimeMs: number
  readonly pnpmDirMtimeMs: number
  readonly startedAt: number
}

// Compare merged aggregate coverage against configured thresholds. Returns the
// list of metrics that fell short (empty when all pass or no thresholds set).
export function checkThresholds(
  aggregate: AggregateCoverage | undefined,
  thresholds: CoverThresholds | undefined,
): string[] {
  return computeThresholdFailures(aggregate, thresholds)
}

// Strip ANSI codes and decorative characters (✧, ︎ variation selector, ⚡) from
// text. Uses the canonical lib-stable stripAnsi so there's one ANSI definition
// fleet-wide (the test helper at test/fleet/_shared/lib/output.mts wraps the
// same).
export function cleanOutput(text: string): string {
  return cleanOutputText(text)
}

// Run a command quietly, capturing stdout/stderr and never throwing — a
// non-zero exit becomes an exitCode in the returned result so callers can still
// parse coverage output.
export async function runQuiet(
  args: string[],
  config: { cwd: string; env?: NodeJS.ProcessEnv | undefined },
): Promise<SuiteResult> {
  return runQuietCommand(args, config)
}

/**
 * The unit-suite wall-clock budget from the per-repo settings file
 * (`vitest.unitBudgetMs`), falling back to the fleet default. Fail-open: a
 * missing or torn settings file yields the default.
 */
export function resolveUnitBudgetMs(): number {
  return resolveConfiguredUnitBudgetMs()
}

/**
 * Loud report-only budget warning (What / Where / Saw vs wanted / Fix). Stays
 * a warning until the fleet conforms, then ratchets to a hard failure.
 */
export function warnIfOverBudget(suiteMs: number, budgetMs: number): boolean {
  return evaluateBudgetOverrun(suiteMs, budgetMs)
}

/**
 * LIVE wall-clock watchdog for the unit suites — see cover-report.mts for the
 * full rationale. Returns a disposer that clears it (call from a `finally`).
 */
export function startUnitBudgetWatchdog(budgetMs: number): () => void {
  return armUnitBudgetWatchdog(budgetMs)
}

export function parseTypeCoveragePercent(output: string): number | undefined {
  return parseTypeCoveragePercentValue(output)
}

// Explain a failing suite — see cover-report.mts for the full rationale.
// Returns the error-ish lines from the suite output (deduped, capped),
// falling back to the output tail; empty for a passing suite.
export function extractSuiteFailureLines(
  name: string,
  result: SuiteResult,
): string[] {
  return buildSuiteFailureReport(name, result)
}

export function snapshotEnvState(): EnvSnapshot {
  return captureEnvSnapshot()
}

export function describeLiveActors(windowMs: number): string[] {
  return collectLiveActorNotes(windowMs)
}

export function describeChurnSince(snapshot: EnvSnapshot): string[] {
  return collectChurnNotes(snapshot)
}

// Run the main suite and, when isolatedArgs is provided, the isolated suite.
// Returns individual results plus a combined view; isolatedResult is undefined
// when the repo ships no isolated suite.
export async function runTestSuites(
  mainArgs: string[],
  isolatedArgs: string[] | undefined,
): Promise<TestSuitesResult> {
  return executeTestSuites(mainArgs, isolatedArgs)
}

// Print the test summary, optional v8 detail table, and the coverage summary.
export function displayCodeCoverage(
  mainOutput: string,
  combinedOutput: string,
  aggregateCoverage: AggregateCoverage | undefined,
  config: { showDetail: boolean; typeCoveragePercent: number | undefined },
): void {
  renderCodeCoverageDisplay(
    mainOutput,
    combinedOutput,
    aggregateCoverage,
    config,
  )
}

/**
 * Convert the raw NODE_V8_COVERAGE output spawned children wrote during the
 * suites into the children tier's coverage-final.json — see cover-run.mts for
 * the full rationale. Returns true when a report was produced.
 */
export async function convertChildrenCoverage(): Promise<boolean> {
  return buildChildrenCoverageReport()
}

export async function main(): Promise<void> {
  // Re-exec under the pinned node when a stale PATH node (below the hook floor)
  // is active, so the coverage vitest + the hooks it spawns run on the fleet
  // runtime instead of failing "Hook requires Node >= 24".
  ensurePinnedNode()
  const { values } = parseArgs({
    options: {
      'code-only': { type: 'boolean', default: false },
      'type-only': { type: 'boolean', default: false },
      summary: { type: 'boolean', default: false },
    },
    strict: false,
  })

  printHeader('Test Coverage')
  logger.log('')

  const envSnapshot = snapshotEnvState()
  const liveActors = describeLiveActors(10 * 60 * 1000)
  if (liveActors.length > 0) {
    logger.warn(
      'Live foreign actor(s) detected — baseline results may be churn-poisoned:',
    )
    logger.group()
    for (const line of liveActors) {
      logger.warn(line)
    }
    logger.groupEnd()
  }

  const buildFailed = await buildWithSourceMaps(rootPath)

  const { coverConfig, isolatedVitestArgs, mainVitestArgs, typeCoverageArgs } =
    resolveRunPlan(rootPath)

  try {
    let exitCode = 0

    if (values['type-only']) {
      const typeCoverageResult = await runQuiet(typeCoverageArgs, {
        cwd: rootPath,
      })
      exitCode = typeCoverageResult.exitCode

      const typeCoverageOutput = (
        typeCoverageResult.stdout + typeCoverageResult.stderr
      ).trim()
      const typeCoveragePercent = parseTypeCoveragePercent(typeCoverageOutput)

      if (typeCoveragePercent !== undefined) {
        logger.log('')
        logger.log(' Coverage Summary')
        logger.log(' ───────────────────────────────')
        logger.log(` Type Coverage: ${typeCoveragePercent.toFixed(2)}%`)
        logger.log('')
      }
    } else {
      const budgetMs = resolveUnitBudgetMs()
      const suiteStart = performance.now()
      const stopWatchdog = startUnitBudgetWatchdog(budgetMs)
      let suiteResults: TestSuitesResult
      try {
        suiteResults = await runTestSuites(mainVitestArgs, isolatedVitestArgs)
      } finally {
        stopWatchdog()
      }
      warnIfOverBudget(performance.now() - suiteStart, budgetMs)
      const { combined, isolatedResult, mainResult } = suiteResults
      exitCode = combined.exitCode

      const mainOutput = cleanOutput(mainResult.stdout + mainResult.stderr)
      const combinedOutput = cleanOutput(combined.stdout + combined.stderr)

      let typeCoveragePercent: number | undefined
      if (!values['code-only']) {
        const typeCoverageResult = await runQuiet(typeCoverageArgs, {
          cwd: rootPath,
        })
        const typeCoverageOutput = (
          typeCoverageResult.stdout + typeCoverageResult.stderr
        ).trim()
        typeCoveragePercent = parseTypeCoveragePercent(typeCoverageOutput)
      }

      // Disabled seam (#213 step 1): strict-tier enforcement. A suite that ran
      // must have produced its tier's coverage-final.json; a dropped tier
      // silently narrows the merge and over-reports (a false-green). Gated OFF
      // by default — the 'shared' tier always runs, 'isolated' only when its
      // suite is resolved. Flip on with FLEET_COVER_STRICT_TIERS=1 once a
      // supervised `cover` run confirms the wheelhouse emits every resolved
      // tier; step 2 promotes this gate into `.config/repo/cover.json`.
      const expectedTiers =
        process.env['FLEET_COVER_STRICT_TIERS'] === '1'
          ? ['shared', ...(isolatedVitestArgs ? ['isolated'] : [])]
          : undefined
      // Convert the raw subprocess coverage the suites' children wrote before
      // the merge reads the children tier.
      try {
        await convertChildrenCoverage()
      } catch (e) {
        logger.warn(`Subprocess coverage conversion failed: ${errorMessage(e)}`)
      }
      let aggregateCoverage: AggregateCoverage | undefined
      try {
        aggregateCoverage = await mergeCoverageFinal({
          expectedTiers,
          logger,
          rootPath,
        })
      } catch (e) {
        if (e instanceof MissingTierCoverageError) {
          logger.error(`Coverage tier dropped: ${errorMessage(e)}`)
          exitCode = exitCode === 0 ? 1 : exitCode
        } else {
          logger.warn(
            `Could not compute aggregate coverage: ${errorMessage(e)}`,
          )
        }
      }

      // mergeCoverageFinal (above) persists the folded coverage-final.json +
      // coverage-summary.json at the coverage-home root as a side effect — the
      // badge + release gate read the summary from COVERAGE_SUMMARY_PATH.

      displayCodeCoverage(mainOutput, combinedOutput, aggregateCoverage, {
        showDetail: !values['summary'],
        typeCoveragePercent,
      })

      // Gate on configured thresholds: any metric under its minimum fails the
      // run. Repos with no thresholds in cover.json are report-only.
      const thresholdFailures = checkThresholds(
        aggregateCoverage,
        coverConfig.thresholds,
      )
      if (thresholdFailures.length) {
        logger.error(
          `Coverage below threshold: ${thresholdFailures.join(', ')}`,
        )
        exitCode = exitCode === 0 ? 1 : exitCode
      }

      // A failing suite must say WHY before the terminal "Coverage failed":
      // per-suite vitest errors (config-level threshold misses, test
      // failures) live only in the captured suite output.
      if (combined.exitCode !== 0) {
        const failureLines = [
          ...extractSuiteFailureLines('main', mainResult),
          ...(isolatedResult
            ? extractSuiteFailureLines('isolated', isolatedResult)
            : []),
        ]
        for (let i = 0, { length } = failureLines; i < length; i += 1) {
          const line = failureLines[i]!
          logger.error(line)
        }
        const churn = describeChurnSince(envSnapshot)
        if (churn.length > 0) {
          logger.warn(
            'Concurrent-churn evidence (weigh failures against this before treating them as regressions):',
          )
          logger.group()
          for (const line of churn) {
            logger.warn(line)
          }
          logger.groupEnd()
        }
      }
    }

    if (buildFailed) {
      exitCode = 1
    }

    if (exitCode === 0) {
      logger.success('Coverage completed successfully')
    } else {
      logger.error('Coverage failed')
    }

    process.exitCode = exitCode
  } catch (e) {
    logger.error(`Coverage script failed: ${errorMessage(e)}`)
    process.exitCode = 1
  }
}

// Entrypoint-guarded: importing this module (a unit test of
// extractSuiteFailureLines) must NOT launch a coverage run. An unguarded
// import inside a coverage-instrumented vitest worker starts a NESTED cover
// run whose startup cleans the shared coverage/.tmp and ENOENTs the outer
// run's v8 reports (four cover runs died this way on 2026-07-11).
if (isMainModule(import.meta.url)) {
  reexecWithHeapHeadroom(fileURLToPath(import.meta.url))
  registerActiveRun()
  main()
    .catch((e: unknown) => {
      logger.error(`Coverage script failed: ${errorMessage(e)}`)
      process.exitCode = 1
    })
    .finally(() => {
      unregisterActiveRun()
    })
}
