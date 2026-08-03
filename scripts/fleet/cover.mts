#!/usr/bin/env node
/**
 * @file Coverage runner — builds with source maps, runs vitest with coverage,
 *   masks test output, and prints a coverage summary. Runs the main suite and,
 *   when the repo ships one, an isolated suite (forks, full isolation for tests
 *   that mock globals / chdir / mutate process.env); the two coverage reports
 *   are merged with a max-hit-count strategy. Byte-identical across every fleet
 *   repo, sync-scaffolding flags drift. Config discovery is repo-first:
 *   `.config/repo/vitest.config.mts` then legacy `.config/vitest.config.mts`;
 *   the isolated suite runs only when `.config/repo/vitest.config.isolated.mts`
 *   (or the legacy `.config/` location) exists. Options: --code-only run only
 *   code coverage, skip type coverage; --type-only run only type coverage;
 *   --summary hide the detailed v8 table, show only the summary.
 */

// Imported FIRST: pins a per-run-unique FLEET_COVERAGE_SCRATCH_DIR into the env
// BEFORE paths.mts derives COVERAGE_SCRATCH_DIR from it, so concurrent cover
// runs can't wipe each other's scratch, the cover-gate wobble. Side-effect
// import — keep it above every import that transitively loads paths.mts.
import './cover/scratch-isolation.mts'

import path from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
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
  countRawV8Profiles,
  executeTestSuites,
  IncompleteChildCaptureError,
  isConversionEmptyDespiteProfiles,
  pnpmDirChurned,
  reexecWithHeapHeadroom,
  resolveRunPlan,
  runQuietCommand,
  shouldRetryForChurn,
  shouldRetryForEmptyConversion,
  waitForPnpmQuiescence,
} from './cover-run.mts'
export {
  countRawV8Profiles,
  isChurnAttributableFailure,
  isConversionEmptyDespiteProfiles,
  pnpmDirChurned,
  shouldRetryForChurn,
  shouldRetryForEmptyConversion,
  waitForPnpmQuiescence,
} from './cover-run.mts'
export type {
  ChurnRetryDecision,
  EmptyConversionDecision,
  EmptyConversionRetryDecision,
  QuiescenceDeps,
  QuiescenceOptions,
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
import {
  COVERAGE_DIR,
  COVERAGE_SCRATCH_DIR,
  COVERAGE_SUMMARY_PATH,
  REPO_ROOT,
} from './paths.mts'
import { runBunCoverageLane } from './cover/bun-lane.mts'
import {
  combineWithTsLines,
  defaultLaneCommandRunner,
  persistLaneSummary,
  rewriteSummaryLines,
  runNativeLanes,
} from './cover/native-lanes.mts'
import type { NativeLanesOutcome } from './cover/native-lanes.mts'
import type { AggregateCoverage } from './util/coverage-merge.mts'
import {
  mergeCoverageFinal,
  MissingTierCoverageError,
} from './util/coverage-merge.mts'

const rootPath = REPO_ROOT

const logger = getDefaultLogger()

// Total suite-run budget when a failure coincides with concurrent
// node_modules/.pnpm churn: the initial run plus up to two churn-inconclusive
// retries. A churn-free failure never consumes the budget (it fails on the
// first run), and the bound guarantees a repo under sustained install churn
// still terminates instead of retrying forever.
const COVER_MAX_ATTEMPTS = 3

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
// list of metrics that fell short, empty when all pass or no thresholds set.
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
// Returns the error-ish lines from the suite output, deduped, capped,
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

/**
 * The NATIVE half of the run: every coverage lane this repo's declared
 * `capabilities` activate (rust/go/cpp), folded into the same report the TS
 * pass produced. A TypeScript-only repo resolves no lanes, so this costs one
 * config read and changes nothing it writes.
 *
 * `tsLines` is the TS line tally from the merged aggregate, or undefined when
 * the merge produced none; the combined percentage the badge reads is the sum
 * of both sides' raw counts, never an average of two percentages. Returns the
 * lane exit code so the caller folds it into the run's own.
 */
export async function runNativeCoverageLanes(
  tsLines: { coveredLines: number; totalLines: number } | undefined,
): Promise<number> {
  const outcome: NativeLanesOutcome = await runNativeLanes({
    detailDir: path.join(COVERAGE_DIR, 'lanes'),
    logger,
    repoRoot: rootPath,
    runner: defaultLaneCommandRunner,
    scratchDir: COVERAGE_SCRATCH_DIR,
  })
  if (outcome.results.length === 0) {
    return 0
  }
  persistLaneSummary(COVERAGE_DIR, outcome)
  logger.log('')
  logger.log(' Coverage by language')
  for (let i = 0, { length } = outcome.breakdownLines; i < length; i += 1) {
    logger.log(outcome.breakdownLines[i]!)
  }
  const combined = combineWithTsLines(tsLines, outcome.combined)
  if (combined) {
    rewriteSummaryLines(COVERAGE_SUMMARY_PATH, combined.pct)
  }
  return outcome.exitCode
}

export async function main(): Promise<void> {
  // Re-exec under the pinned node when a stale PATH node, below the hook floor
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

  const plan = resolveRunPlan(rootPath)
  const { coverConfig, isolatedVitestArgs, mainVitestArgs, typeCoverageArgs } =
    plan

  // A cover-config problem is FATAL, for both runners. An unrecognized
  // `cover.runner` would fall back to vitest and run the wrong gate; an
  // unrecognized threshold metric would be ignored and turn a configured
  // minimum into no minimum. Either way the run would report a number nobody
  // asked for, which is the false-green this whole runner exists to prevent.
  if (plan.configErrors.length > 0) {
    for (let i = 0, { length } = plan.configErrors; i < length; i += 1) {
      logger.error(plan.configErrors[i]!)
    }
    process.exitCode = 1
    return
  }

  // The bun lane owns its whole run: bun writes lcov, the lane folds it into
  // the same aggregate the vitest merge produces, persists the summary the
  // badge reads, and applies the thresholds itself. It reuses the shared
  // display + aggregate-threshold gate below so both runners are reported and
  // gated identically.
  if (plan.runner === 'bun') {
    const lane = await runBunCoverageLane({
      configPath: plan.configPath ?? '<no socket-wheelhouse.json>',
      coverConfig,
      coverageDir: COVERAGE_DIR,
      passthroughArgs: plan.passthroughArgs,
      repoRoot: rootPath,
      runner: async args => ({
        exitCode: (await runQuiet(args, { cwd: rootPath })).exitCode,
      }),
      summaryPath: COVERAGE_SUMMARY_PATH,
    })
    let exitCode = lane.exitCode
    displayCodeCoverage('', '', lane.aggregate, {
      showDetail: !values['summary'],
      typeCoveragePercent: undefined,
    })
    const thresholdFailures = checkThresholds(
      lane.aggregate,
      coverConfig.thresholds,
    )
    if (thresholdFailures.length) {
      logger.error(`Coverage below threshold: ${thresholdFailures.join(', ')}`)
      exitCode = exitCode === 0 ? 1 : exitCode
    }
    // The native lanes run under BOTH runners: a repo declaring `cargo` must
    // measure its Rust whether its JS tests run on bun or on vitest, so the
    // runner choice cannot decide whether a language is covered.
    const nativeExitCode = await runNativeCoverageLanes(
      lane.aggregate
        ? {
            coveredLines: lane.aggregate.coveredLines,
            totalLines: lane.aggregate.totalLines,
          }
        : undefined,
    )
    if (nativeExitCode !== 0) {
      exitCode = exitCode === 0 ? nativeExitCode : exitCode
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
    return
  }

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
      // Disabled seam (#213 step 1): strict-tier enforcement. A suite that ran
      // must have produced its tier's coverage-final.json; a dropped tier
      // silently narrows the merge and over-reports, a false-green. Gated OFF
      // by default — the 'shared' tier always runs, 'isolated' only when its
      // suite is resolved. Flip on with FLEET_COVER_STRICT_TIERS=1 once a
      // supervised `cover` run confirms the wheelhouse emits every resolved
      // tier; step 2 promotes this gate into the `cover` section of
      // `.config/repo/socket-wheelhouse.json`.
      const expectedTiers =
        process.env['FLEET_COVER_STRICT_TIERS'] === '1'
          ? ['shared', ...(isolatedVitestArgs ? ['isolated'] : [])]
          : undefined

      // Run the suites, convert the raw v8 profiles, and merge — retrying when
      // the run is INCONCLUSIVE. Two inconclusive conditions share one bounded
      // budget (COVER_MAX_ATTEMPTS):
      //   1. A test failure that coincided with concurrent node_modules/.pnpm
      //      churn, module resolution was transiently broken.
      //   2. An empty v8→istanbul conversion despite raw profiles being
      //      captured — the false-green this runner exists to catch: a churn
      //      mid-conversion can gut coverage-final.json while the raw dumps are
      //      intact, so 0.00% is reported for every file. A re-run regenerates
      //      the raw profiles AND reconverts, resolving a churn-corrupted
      //      conversion. A churn-free test failure breaks out immediately and
      //      stays fatal; a persistently-empty conversion fails LOUD below.
      let suiteResults: TestSuitesResult
      let aggregateCoverage: AggregateCoverage | undefined
      let conversionEmptyDespiteProfiles = false
      let rawProfileCount = 0
      let captureIncomplete = false
      let tierDropped = false
      let attempt = 1
      for (;;) {
        captureIncomplete = false
        tierDropped = false
        aggregateCoverage = undefined
        const beforeRun = snapshotEnvState()
        const suiteStart = performance.now()
        const stopWatchdog = startUnitBudgetWatchdog(budgetMs)
        try {
          // eslint-disable-next-line no-await-in-loop
          suiteResults = await runTestSuites(mainVitestArgs, isolatedVitestArgs)
        } finally {
          stopWatchdog()
        }
        warnIfOverBudget(performance.now() - suiteStart, budgetMs)
        const churnedDuringRun = pnpmDirChurned(beforeRun, snapshotEnvState())
        const failed = suiteResults.combined.exitCode !== 0

        // Count the raw v8 profiles THIS run produced BEFORE the conversion
        // consumes, and deletes, the children-raw dir — the "raw profiles
        // present" half of the false-green test.
        rawProfileCount = countRawV8Profiles()

        // Convert the raw subprocess coverage the suites' children wrote before
        // the merge reads the children tier.
        try {
          // eslint-disable-next-line no-await-in-loop
          await convertChildrenCoverage()
        } catch (e) {
          if (e instanceof IncompleteChildCaptureError) {
            // Provably-incomplete capture — fail LOUD rather than merge a
            // partial, which would silently under-report on runner timing.
            logger.error(
              `Subprocess coverage capture incomplete: ${errorMessage(e)}`,
            )
            captureIncomplete = true
          } else {
            logger.warn(
              `Subprocess coverage conversion failed: ${errorMessage(e)}`,
            )
          }
        }
        try {
          // eslint-disable-next-line no-await-in-loop
          aggregateCoverage = await mergeCoverageFinal({
            expectedTiers,
            logger,
            rootPath,
          })
        } catch (e) {
          if (e instanceof MissingTierCoverageError) {
            logger.error(`Coverage tier dropped: ${errorMessage(e)}`)
            tierDropped = true
          } else {
            logger.warn(
              `Could not compute aggregate coverage: ${errorMessage(e)}`,
            )
          }
        }

        // The false-green: raw v8 profiles captured but the merged report has
        // no measurable statements (an empty/unpopulated coverage-final.json).
        // Distinct from a genuine 0% statements present, none covered, and a
        // genuinely empty scope, no raw profiles.
        conversionEmptyDespiteProfiles = isConversionEmptyDespiteProfiles({
          hasMeasurableStatements:
            aggregateCoverage !== undefined &&
            aggregateCoverage.totalStatements > 0,
          rawProfileCount,
        })

        const retryForChurn = shouldRetryForChurn({
          attempt,
          churnedDuringRun,
          failed,
          failureOutput:
            suiteResults.combined.stderr + suiteResults.combined.stdout,
          maxAttempts: COVER_MAX_ATTEMPTS,
        })
        const retryForEmptyConversion = shouldRetryForEmptyConversion({
          attempt,
          conversionEmpty: conversionEmptyDespiteProfiles,
          maxAttempts: COVER_MAX_ATTEMPTS,
        })
        if (!retryForChurn && !retryForEmptyConversion) {
          break
        }
        if (retryForEmptyConversion) {
          logger.warn(
            `Coverage conversion produced empty output despite ${rawProfileCount} raw v8 profile(s) (attempt ${attempt}/${COVER_MAX_ATTEMPTS}) — a v8→istanbul conversion failure (typically a mid-run node_modules/.pnpm churn), NOT a real 0%. Waiting for install-state to settle, then re-running to regenerate + reconvert.`,
          )
        } else {
          logger.warn(
            `Suite failed while node_modules/.pnpm churned mid-run (attempt ${attempt}/${COVER_MAX_ATTEMPTS}) — treating as INCONCLUSIVE; waiting for install-state to settle before re-running.`,
          )
        }
        attempt += 1
        // eslint-disable-next-line no-await-in-loop
        await waitForPnpmQuiescence()
      }
      const { combined, isolatedResult, mainResult } = suiteResults
      exitCode = combined.exitCode
      if (captureIncomplete) {
        exitCode = exitCode === 0 ? 1 : exitCode
      }
      if (tierDropped) {
        exitCode = exitCode === 0 ? 1 : exitCode
      }

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

      // FAIL LOUD: raw v8 profiles were captured but the conversion STILL
      // produced an empty report after the retry budget — never report 0.00%
      // and exit 0 (a false-green the badge + release gate would trust).
      if (conversionEmptyDespiteProfiles) {
        logger.error(
          `Coverage conversion produced empty output despite ${rawProfileCount} raw v8 profile(s). ` +
            `Where: mergeCoverageFinal over ${COVERAGE_DIR}. ` +
            `Saw vs wanted: saw 0 measured statements from a populated raw-profile capture; wanted the real per-file coverage. ` +
            `Fix: a mid-run node_modules/.pnpm churn most likely broke module resolution for the v8→istanbul conversion — re-run \`pnpm run cover\` on a quiescent tree, or investigate the conversion step (c8 Report / vitest v8 provider).`,
        )
        exitCode = exitCode === 0 ? 1 : exitCode
      }

      // mergeCoverageFinal (above) persists the folded coverage-final.json +
      // coverage-summary.json at the coverage-home root as a side effect — the
      // badge + release gate read the summary from COVERAGE_SUMMARY_PATH.

      displayCodeCoverage(mainOutput, combinedOutput, aggregateCoverage, {
        showDetail: !values['summary'],
        typeCoveragePercent,
      })

      // Gate on configured thresholds: any metric under its minimum fails the
      // run. Repos with no thresholds in their cover config are report-only.
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

      // The native lanes measure the languages the v8 pass cannot see. Skipped
      // entirely under --type-only, which runs no test suite at all.
      const nativeExitCode = await runNativeCoverageLanes(
        aggregateCoverage
          ? {
              coveredLines: aggregateCoverage.coveredLines,
              totalLines: aggregateCoverage.totalLines,
            }
          : undefined,
      )
      if (nativeExitCode !== 0) {
        exitCode = exitCode === 0 ? nativeExitCode : exitCode
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
      // Remove this run's private scratch dir. With a fixed shared path the
      // next run's startup wipe reclaimed it; a per-run-unique dir has no next
      // run to clean it, so it must clean up after itself or leak into tmpdir.
      // COVERAGE_DIR (the persisted summary/final the badge + gate read) lives
      // elsewhere and is untouched.
      safeDeleteSync(COVERAGE_SCRATCH_DIR, { force: true, recursive: true })
    })
}
