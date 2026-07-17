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

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { stripAnsi } from '@socketsecurity/lib-stable/ansi/strip'
import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import {
  spawn,
  spawnSync,
} from '@socketsecurity/lib-stable/process/spawn/child'

import {
  registerActiveRun,
  unregisterActiveRun,
} from './_shared/active-run-marker.mts'
import { printHeader } from '@socketsecurity/lib-stable/stdio/header'

import type { AggregateCoverage } from './util/coverage-merge.mts'
import {
  mergeCoverageFinal,
  MissingTierCoverageError,
} from './util/coverage-merge.mts'
import { resolveCoverageConfig } from '../../.config/fleet/vitest.coverage.fleet.config.mts'
import type { CoverThresholds, ResolvedSuite } from './cover/discovery.mts'
import {
  readCoverConfig,
  resolveBuildEntry,
  resolveSuites,
} from './cover/discovery.mts'
import { ensurePinnedNode } from './lib/ensure-node.mts'
import {
  COVERAGE_CHILDREN_DIR,
  COVERAGE_CHILDREN_RAW_DIR,
  REPO_ROOT,
} from './paths.mts'
import { isMainModule } from './_shared/is-main-module.mts'

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

// Compare merged aggregate coverage against configured thresholds. Returns the
// list of metrics that fell short (empty when all pass or no thresholds set).
export function checkThresholds(
  aggregate: AggregateCoverage | undefined,
  thresholds: CoverThresholds | undefined,
): string[] {
  if (!thresholds) {
    return []
  }
  // Fail CLOSED: thresholds are configured, so a missing aggregate (e.g. a
  // tier clobbered coverage/coverage-final.json before the merge read it)
  // must fail the gate — returning "no failures" here shipped a false-green
  // run that reported success below its configured minimums.
  if (!aggregate) {
    return [
      'aggregate coverage unavailable (coverage-final.json missing or empty) — cannot verify thresholds',
    ]
  }
  const failures: string[] = []
  const metrics: ReadonlyArray<keyof CoverThresholds> = [
    'statements',
    'branches',
    'functions',
    'lines',
  ]
  for (let i = 0, { length } = metrics; i < length; i += 1) {
    const metric = metrics[i]!
    const min = thresholds[metric]
    if (min === undefined) {
      continue
    }
    const actual = Number.parseFloat(aggregate[metric])
    if (actual < min) {
      failures.push(`${metric} ${actual.toFixed(2)}% < ${min}%`)
    }
  }
  return failures
}

// Strip ANSI codes and decorative characters (✧, ︎ variation selector, ⚡) from
// text. Uses the canonical lib-stable stripAnsi so there's one ANSI definition
// fleet-wide (the test helper at test/_shared/fleet/lib/output.mts wraps the
// same).
export function cleanOutput(text: string): string {
  return stripAnsi(text)
    .replace(/(?:⚡|✧|︎)\s*/g, '')
    .trim()
}

// Run a command quietly, capturing stdout/stderr and never throwing — a
// non-zero exit becomes an exitCode in the returned result so callers can still
// parse coverage output. Replaces the old repo-local run-command helper with a
// direct lib-stable spawn so the runner is self-contained and cascade-portable.
export async function runQuiet(
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv | undefined },
): Promise<SuiteResult> {
  options = { __proto__: null, ...options } as typeof options
  try {
    // A pnpm shim can select a different `node` from PATH than the runtime
    // executing this coverage process. Prefer pnpm's JS entrypoint so the test
    // children stay on this exact Node, and lead PATH with the same binary dir
    // because `pnpm exec` launches local Node CLIs by name.
    const pnpmEntry = process.env['npm_execpath']
    const command = pnpmEntry ? process.execPath : 'pnpm'
    const commandArgs = pnpmEntry ? [pnpmEntry, ...args] : args
    const env = options.env ?? process.env
    const nodeBin = path.dirname(process.execPath)
    const result = await spawn(command, commandArgs, {
      cwd: options.cwd,
      env: {
        ...env,
        PATH: [nodeBin, env['PATH']].filter(Boolean).join(path.delimiter),
      },
    })
    return {
      exitCode: result.code ?? 0,
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
    }
  } catch (e) {
    const err = e as Record<string, unknown>
    return {
      exitCode: 1,
      stdout: (err['stdout'] as string) || '',
      stderr: (err['stderr'] as string) || (err['message'] as string) || '',
    }
  }
}

// Fleet default wall-clock budget for the unit suites: under a minute
// (operator directive 2026-07-10). Repos tune via `vitest.unitBudgetMs` in
// .config/socket-wheelhouse.json.
const DEFAULT_UNIT_BUDGET_MS = 60_000

/**
 * The unit-suite wall-clock budget from the per-repo settings file
 * (`vitest.unitBudgetMs`), falling back to the fleet default. Fail-open: a
 * missing or torn settings file yields the default.
 */
export function resolveUnitBudgetMs(): number {
  for (const file of [
    // Canonical settings home (matches paths.mts's resolver order). Omitting it
    // — as this reader did — silently ignored `vitest.unitBudgetMs` set in the
    // repo's real settings file, pinning the budget to the 60s default.
    '.config/repo/socket-wheelhouse.json',
    '.config/socket-wheelhouse.json',
    '.socket-wheelhouse.json',
  ]) {
    if (!existsSync(file)) {
      continue
    }
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
        vitest?: { unitBudgetMs?: number | undefined } | undefined
      }
      const ms = parsed?.vitest?.unitBudgetMs
      return typeof ms === 'number' && ms >= 1000 ? ms : DEFAULT_UNIT_BUDGET_MS
    } catch {
      return DEFAULT_UNIT_BUDGET_MS
    }
  }
  return DEFAULT_UNIT_BUDGET_MS
}

/**
 * Loud report-only budget warning (What / Where / Saw vs wanted / Fix). Stays
 * a warning until the fleet conforms, then ratchets to a hard failure.
 */
export function warnIfOverBudget(suiteMs: number, budgetMs: number): boolean {
  if (suiteMs <= budgetMs) {
    return false
  }
  logger.warn(
    `[cover] unit suites exceeded the wall-clock budget: ${(suiteMs / 1000).toFixed(1)}s > ${(budgetMs / 1000).toFixed(0)}s.`,
  )
  logger.warn(
    '  Fleet rule: unit tests conclude in under a minute. Move heavy external-suite /',
  )
  logger.warn(
    '  cross-impl / built-artifact tests to the conformance tier: list their globs under',
  )
  logger.warn(
    '  `vitest.conformanceExclude` in .config/socket-wheelhouse.json and pair them with a',
  )
  logger.warn(
    '  `test:conformance` runner script. Tune the budget via `vitest.unitBudgetMs`.',
  )
  logger.warn(
    '  If the run instead HUNG (no completion), investigate a wedge — see the live',
  )
  logger.warn('  watchdog guidance above.')
  return true
}

/**
 * LIVE wall-clock watchdog for the unit suites. `warnIfOverBudget` only fires
 * AFTER the suites return, which is useless in the case that actually burns an
 * operator: a suite that HANGS (a stuck child spawn, a missing nock mock
 * blocking on a real socket — tests fail-closed on network, an infinite loop)
 * never completes, so the post-hoc check never runs and whoever launched it
 * waits blind. This fires WHILE the run is live — at the budget, then again
 * each budget interval — telling them to INVESTIGATE rather than keep waiting.
 * It never kills the run: a legitimately heavy suite still finishes and the nag
 * is just noise; a wedged one becomes visible instead of silent. The timer is
 * `unref`'d so a clean finish exits immediately with no pending-tick delay.
 * Returns a disposer that clears it (call from a `finally`).
 */
export function startUnitBudgetWatchdog(budgetMs: number): () => void {
  let elapsedMs = 0
  const timer = setInterval(() => {
    elapsedMs += budgetMs
    logger.warn(
      `[cover] unit suites STILL RUNNING after ${(elapsedMs / 1000).toFixed(0)}s (budget ${(budgetMs / 1000).toFixed(0)}s) — INVESTIGATE, do not just wait.`,
    )
    logger.warn(
      '  A run this far over budget is usually WEDGED, not merely heavy: a hung',
    )
    logger.warn(
      '  child spawn, a missing nock mock blocking on a real socket, or an infinite',
    )
    logger.warn(
      '  loop. Check for a stuck vitest/node child (ps); narrow scope to bisect the',
    )
    logger.warn(
      '  offending file. Genuinely heavy? Move it to the conformance tier or raise',
    )
    logger.warn('  vitest.unitBudgetMs.')
  }, budgetMs)
  // Do not let a pending tick hold the process open past a clean finish.
  timer.unref?.()
  return () => {
    clearInterval(timer)
  }
}

export function parseTypeCoveragePercent(output: string): number | undefined {
  // Extracts a floating-point percentage from type-coverage output.
  // \( ... \)  — literal parens wrapping the fraction, e.g. "(123 / 456)"
  // [\d\s/]+   — digits, spaces, and "/" inside the parens
  // \s+        — whitespace separator between fraction and percentage
  // ([\d.]+)%  — capture group 1: the percentage digits before the "%" sign
  const match = output.match(/\([\d\s/]+\)\s+([\d.]+)%/)
  return match?.[1] ? Number.parseFloat(match[1]) : undefined
}

// Explain a failing suite: vitest prints its per-config coverage-threshold
// misses (e.g. "ERROR: Coverage for branches (46.92%) does not meet global
// threshold (49%)") to the suite's own output, which the summary display
// filters out — a bare "Coverage failed" strands the operator without the
// failing metric. Returns the error-ish lines from the suite output (deduped,
// capped), falling back to the output tail; empty for a passing suite.
export function extractSuiteFailureLines(
  name: string,
  result: SuiteResult,
): string[] {
  if (result.exitCode === 0) {
    return []
  }
  const maxLines = 12
  const lines = cleanOutput(result.stdout + result.stderr)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
  const errorLines = [
    ...new Set(
      lines.filter(line =>
        // `ERROR` keyword; vitest coverage threshold message ("does not meet"
        // / "threshold"); vitest final summary line ("Tests N failed").
        /\bERROR\b|does not meet|threshold|Tests\s+\d+\s+failed/i.test(line),
      ),
    ),
  ]
  const detail = (errorLines.length > 0 ? errorLines : lines.slice(-maxLines))
    .slice(0, maxLines)
    .map(line => `  ${line}`)
  const dumpPath = persistSuiteFailureOutput(name, result)
  return [
    `${name} suite failed (exit ${result.exitCode}):`,
    ...detail,
    ...(dumpPath ? [`  full suite output: ${dumpPath}`] : []),
  ]
}

// The 12-line summary above filters the suite output down to error-ish
// lines, which hides the real diagnostic when a worker dies mid-run (a heap
// OOM abort, a SIGKILL, a vanished v8 report). Persist the COMPLETE output
// where the operator can read it; a masked failure is a silent strand.
function persistSuiteFailureOutput(
  name: string,
  result: SuiteResult,
): string | undefined {
  try {
    const dir = path.join(rootPath, 'node_modules', '.cache', 'fleet-cover')
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `last-failure-${name}.log`)
    writeFileSync(
      file,
      `exit ${result.exitCode}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}\n`,
    )
    return file
  } catch {
    return undefined
  }
}

// Five coverage baselines were corrupted by concurrent activity before the
// evidence trail existed: a parallel session's live edits mid-run (73
// phantom failures), a mid-run pnpm install that transiently gutted module
// resolution (235 phantom import errors), and load-starved child spawns.
// The two helpers below make that churn VISIBLE: announce live foreign
// actors at startup, snapshot the install state, and stamp any failure
// with what changed during the run — a poisoned baseline names its
// poisoner instead of reading as 20+ regressions.
export interface EnvSnapshot {
  readonly lockfileMtimeMs: number
  readonly pnpmDirMtimeMs: number
  readonly startedAt: number
}

export function snapshotEnvState(): EnvSnapshot {
  const mtimeOf = (p: string): number => {
    try {
      return statSync(p).mtimeMs
    } catch {
      return 0
    }
  }
  return {
    lockfileMtimeMs: mtimeOf(path.join(rootPath, 'pnpm-lock.yaml')),
    pnpmDirMtimeMs: mtimeOf(path.join(rootPath, 'node_modules', '.pnpm')),
    startedAt: Date.now(),
  }
}

// Live foreign actors from the active-edits ledger (recorded by the
// active-edits-ledger hook): any actor whose last edit is within the
// window. cover.mts is not a session actor, so every live entry is
// "foreign" from the run's perspective.
export function describeLiveActors(windowMs: number): string[] {
  const out: string[] = []
  try {
    const dir = path.join(
      rootPath,
      'node_modules',
      '.cache',
      'socket-active-edits',
    )
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith('.json')) {
        continue
      }
      try {
        const parsed = JSON.parse(
          readFileSync(path.join(dir, entry), 'utf8'),
        ) as {
          actorId?: string | undefined
          paths?: Record<string, number> | undefined
          updatedAt?: number | undefined
        }
        const updatedAt = parsed.updatedAt ?? 0
        const age = Date.now() - updatedAt
        if (age > windowMs) {
          continue
        }
        const repoPaths = Object.keys(parsed.paths ?? {}).filter(p =>
          p.startsWith(rootPath),
        )
        out.push(
          `actor ${String(parsed.actorId).slice(0, 8)} last edited ${Math.round(age / 60_000)}min ago (${repoPaths.length} path(s) in this repo)`,
        )
      } catch {
        // Unreadable ledger entry — skip it.
      }
    }
  } catch {
    // No ledger dir — nothing to report.
  }
  return out
}

export function describeChurnSince(snapshot: EnvSnapshot): string[] {
  const now = snapshotEnvState()
  const out: string[] = []
  if (now.lockfileMtimeMs !== snapshot.lockfileMtimeMs) {
    out.push('pnpm-lock.yaml CHANGED during the run (a concurrent install).')
  }
  if (now.pnpmDirMtimeMs !== snapshot.pnpmDirMtimeMs) {
    out.push(
      'node_modules/.pnpm CHANGED during the run — module resolution may have been transiently broken for spawned workers.',
    )
  }
  for (const line of describeLiveActors(Date.now() - snapshot.startedAt)) {
    out.push(`live during the run: ${line}`)
  }
  return out
}

// Run the main suite and, when isolatedArgs is provided, the isolated suite.
// Returns individual results plus a combined view; isolatedResult is undefined
// when the repo ships no isolated suite.
export async function runTestSuites(
  mainArgs: string[],
  isolatedArgs: string[] | undefined,
): Promise<TestSuitesResult> {
  // Subprocess coverage capture: the fleet vitest setup bridges this variable
  // into NODE_V8_COVERAGE inside each worker (workers read it only at process
  // START, so they never dump their own coverage) and every node child the
  // tests spawn inherits it, writing raw V8 coverage here on exit. c8 converts
  // the raw dir after the suites finish (convertChildrenCoverage).
  // Purge any prior run's child coverage first: every spawned node child dumps a
  // raw V8 profile here and nothing cleaned it, so the dir accumulated tens of
  // thousands of files (multiple GB) across runs. The merge loads the whole dir
  // into memory at once, so a stale pile OOMs the process and grinds the run.
  // Start each run with only its own children's profiles.
  const childRawDir = COVERAGE_CHILDREN_RAW_DIR
  safeDeleteSync(COVERAGE_CHILDREN_DIR, { force: true, recursive: true })
  mkdirSync(childRawDir, { recursive: true })
  const run = (args: string[]): Promise<SuiteResult> =>
    runQuiet(args, {
      cwd: rootPath,
      env: {
        ...process.env,
        COVERAGE: 'true',
        FLEET_CHILD_V8_COVERAGE_DIR: childRawDir,
      },
    })

  const mainResult = await run(mainArgs)
  const isolatedResult = isolatedArgs ? await run(isolatedArgs) : undefined

  const exitCode =
    mainResult.exitCode !== 0
      ? mainResult.exitCode
      : (isolatedResult?.exitCode ?? 0)

  const combined: SuiteResult = {
    exitCode,
    stderr: mainResult.stderr + (isolatedResult?.stderr ?? ''),
    stdout: mainResult.stdout + (isolatedResult?.stdout ?? ''),
  }

  return { combined, isolatedResult, mainResult }
}

// Print the test summary, optional v8 detail table, and the coverage summary.
export function displayCodeCoverage(
  mainOutput: string,
  combinedOutput: string,
  aggregateCoverage: AggregateCoverage | undefined,
  {
    showDetail,
    typeCoveragePercent,
  }: { showDetail: boolean; typeCoveragePercent: number | undefined },
): void {
  if (showDetail) {
    const testSummaryMatch = combinedOutput.match(
      /Test Files\s+\d+[^\n]*\n[\s\S]*?Duration\s+[\d.]+m?s[^\n]*/,
    )
    if (testSummaryMatch) {
      logger.log('')
      logger.log(testSummaryMatch[0])
      logger.log('')
    }

    const coverageHeaderMatch = mainOutput.match(
      // Matches the v8 coverage table header block in full.
      // " % Coverage report from v8\n"  — literal heading line
      // ([-|]+)                          — capture group 1: separator row of dashes and pipes
      // \n([^\n]+)\n                     — capture group 2: the column-name row between separators
      // \1                               — backreference: the same separator row repeated below headers
      / % Coverage report from v8\n([-|]+)\n([^\n]+)\n\1/,
    )
    const allFilesMatch = mainOutput.match(
      /All files\s+\|\s+([\d.]+)\s+\|[^\n]*/,
    )
    if (coverageHeaderMatch && allFilesMatch) {
      logger.log(' % Coverage report from v8')
      logger.log(coverageHeaderMatch[1])
      logger.log(coverageHeaderMatch[2])
      logger.log(coverageHeaderMatch[1])
      logger.log(allFilesMatch[0])
      logger.log(coverageHeaderMatch[1])
      logger.log('')
    }
  }

  const codeCoveragePercent = aggregateCoverage
    ? Number.parseFloat(aggregateCoverage.statements)
    : (() => {
        const m = mainOutput.match(/All files\s+\|\s+([\d.]+)\s+\|/)
        return m?.[1] ? Number.parseFloat(m[1]) : 0
      })()

  logger.log(' Coverage Summary')
  logger.log(' ───────────────────────────────')

  if (typeCoveragePercent !== undefined) {
    logger.log(` Type Coverage: ${typeCoveragePercent.toFixed(2)}%`)
  }
  logger.log(` Code Coverage: ${codeCoveragePercent.toFixed(2)}%`)

  if (aggregateCoverage) {
    logger.log('')
    logger.log(' Aggregate Code Coverage (Main + Isolated):')
    logger.log(
      `   Statements: ${aggregateCoverage.statements}% | Branches: ${aggregateCoverage.branches}%`,
    )
    logger.log(
      `   Functions:  ${aggregateCoverage.functions}% | Lines:    ${aggregateCoverage.lines}%`,
    )
  }

  if (typeCoveragePercent !== undefined) {
    const cumulativePercent = (
      (codeCoveragePercent + typeCoveragePercent) /
      2
    ).toFixed(2)
    logger.log(' ───────────────────────────────')
    logger.log(` Cumulative:    ${cumulativePercent}%`)
  }

  logger.log('')
}

/**
 * Convert the raw NODE_V8_COVERAGE output spawned children wrote during the
 * suites into coverage-children/coverage-final.json via c8's programmatic
 * Report API (the istanbul-org converter built for exactly this format; the
 * library path — its yargs-driven CLI shim does not load on Node 26).
 * Best-effort: no raw output or no c8 installed → skip with a note; the
 * merge simply proceeds without the children tier. Returns true when a
 * report was produced.
 */
export async function convertChildrenCoverage(): Promise<boolean> {
  const childrenDir = COVERAGE_CHILDREN_DIR
  const rawDir = COVERAGE_CHILDREN_RAW_DIR
  const rawFiles = existsSync(rawDir)
    ? readdirSync(rawDir).filter(f => f.endsWith('.json'))
    : []
  if (rawFiles.length === 0) {
    return false
  }
  let ReportCtor:
    | ((options: object) => { run: () => Promise<void> })
    | undefined
  try {
    const c8 = (await import('c8')) as unknown as {
      Report: (options: object) => { run: () => Promise<void> }
    }
    ReportCtor = c8.Report
  } catch {
    logger.warn(
      `${rawFiles.length} raw subprocess coverage file(s) captured but c8 is not installed — skipping the children tier (install the c8 devDependency to include it).`,
    )
    return false
  }
  // Shape the children report with the SAME include/exclude set the vitest
  // tiers use (fleet base + .config/repo/coverage.json overlay). Children
  // load files far outside the measured set — config, dist, fixtures — and
  // without this filter those gap-fill into the aggregate and inflate the
  // denominator (run 14 live: 3710 children dragged the aggregate BELOW the
  // in-process baseline until the filter landed).
  const coverageShape = resolveCoverageConfig()
  await ReportCtor({
    exclude: coverageShape.exclude,
    excludeAfterRemap: true,
    // c8's default extension list omits .mts/.cts — without them every fleet
    // script is filtered out and the report comes back empty.
    extension: ['.js', '.cjs', '.mjs', '.ts', '.mts', '.cts', '.tsx', '.jsx'],
    include: coverageShape.include,
    reporter: ['json'],
    reportsDirectory: childrenDir,
    src: [rootPath],
    tempDirectory: rawDir,
  }).run()
  const produced = existsSync(path.join(childrenDir, 'coverage-final.json'))
  if (produced) {
    // The converted report is the only child artifact the aggregate merge
    // consumes. Raw V8 profiles are a large intermediate (multiple GB in the
    // wheelhouse suite), so do not retain them until the next coverage run.
    safeDeleteSync(rawDir, { force: true, recursive: true })
    logger.info(
      `Merged subprocess coverage from ${rawFiles.length} spawned child process(es).`,
    )
  }
  return produced
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

  const buildEntry = resolveBuildEntry(rootPath)
  let buildFailed = false
  if (buildEntry) {
    logger.info('Building with source maps for coverage…')
    const buildResult = await spawn('node', [buildEntry], {
      cwd: rootPath,
      stdio: 'inherit',
      env: {
        ...process.env,
        COVERAGE: 'true',
      },
    })
    buildFailed = buildResult.code !== 0
    if (buildFailed) {
      logger.error('Build with source maps failed')
      process.exitCode = 1
    }
    logger.log('')
  } else {
    logger.info(
      'No build entry (scripts/build.mts | bundle.mts) — instrumenting sources directly.',
    )
    logger.log('')
  }

  const customFlags = ['--code-only', '--type-only', '--summary']
  const passthroughArgs = process.argv
    .slice(2)
    .filter(arg => !customFlags.includes(arg))

  const coverConfig = readCoverConfig(rootPath)
  const suites = resolveSuites(rootPath, coverConfig)

  // Build the vitest argv for a resolved suite, threading the suite's
  // per-run --exclude globs (so a test that exercises another package is
  // skipped in this repo's coverage run).
  const suiteVitestArgs = (suite: ResolvedSuite): string[] => [
    'exec',
    'vitest',
    'run',
    ...(suite.config ? ['--config', suite.config] : []),
    '--coverage',
    ...suite.runExclude.flatMap(glob => ['--exclude', glob]),
    ...passthroughArgs,
  ]

  const sharedSuite = suites.find(s => s.name === 'shared')
  const isolatedSuite = suites.find(s => s.name === 'isolated')
  const mainVitestArgs = sharedSuite
    ? suiteVitestArgs(sharedSuite)
    : ['exec', 'vitest', 'run', '--coverage', ...passthroughArgs]
  const isolatedVitestArgs = isolatedSuite
    ? suiteVitestArgs(isolatedSuite)
    : undefined
  const typeCoverageArgs = ['exec', 'type-coverage']

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
      let suites: TestSuitesResult
      try {
        suites = await runTestSuites(mainVitestArgs, isolatedVitestArgs)
      } finally {
        stopWatchdog()
      }
      warnIfOverBudget(performance.now() - suiteStart, budgetMs)
      const { combined, isolatedResult, mainResult } = suites
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
          ? ['shared', ...(isolatedSuite ? ['isolated'] : [])]
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

      // Persist the merged aggregate in the vitest json-summary shape. The
      // badge generator (lib/coverage-badge.mts readCoveragePct) prefers this
      // file over the raw per-tier coverage-summary.json, so the badge shows
      // the twin-folded, children-inclusive number — not the single-tier one.
      if (aggregateCoverage) {
        writeFileSync(
          path.join(rootPath, 'coverage', 'aggregate-summary.json'),
          JSON.stringify({
            total: {
              branches: {
                pct: Number.parseFloat(aggregateCoverage.branches),
              },
              functions: {
                pct: Number.parseFloat(aggregateCoverage.functions),
              },
              lines: { pct: Number.parseFloat(aggregateCoverage.lines) },
              statements: {
                pct: Number.parseFloat(aggregateCoverage.statements),
              },
            },
          }),
        )
      }

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
//
// The coverage merge holds every workspace project's coverage-final.json in
// memory at once; across a large workspace that exceeds node's default old-space
// ceiling and the parent process OOMs mid-merge (observed near 4 GB). Re-exec
// once with a raised heap — 75% of host RAM, floored at 4 GB, capped at 8 GB —
// before any work. The env guard prevents a re-exec loop; an already-raised
// --max-old-space-size (execArgv or NODE_OPTIONS) is left as the operator set it.
const HEAP_ELEVATED_ENV = 'FLEET_COVER_HEAP_ELEVATED'
function reexecWithHeapHeadroom(): void {
  if (process.env[HEAP_ELEVATED_ENV]) {
    return
  }
  const alreadyRaised = [
    ...process.execArgv,
    ...(process.env['NODE_OPTIONS'] ?? '').split(/\s+/),
  ].some(arg => arg.startsWith('--max-old-space-size'))
  if (alreadyRaised) {
    return
  }
  const totalMb = Math.floor(os.totalmem() / (1024 * 1024))
  const heapMb = Math.max(4096, Math.min(8192, Math.floor(totalMb * 0.75)))
  const result = spawnSync(
    process.execPath,
    [
      `--max-old-space-size=${heapMb}`,
      fileURLToPath(import.meta.url),
      ...process.argv.slice(2),
    ],
    { stdio: 'inherit', env: { ...process.env, [HEAP_ELEVATED_ENV]: '1' } },
  )
  process.exit(result.status ?? 1)
}

// Coverage legitimately runs vitest workers hot for many minutes; the
// active-run marker tells the stale-process-sweeper's stuck heuristic this
// worker tree is healthy on-purpose work, not a wedge (see
// scripts/fleet/_shared/active-run-marker.mts for the contract).
if (isMainModule(import.meta.url)) {
  reexecWithHeapHeadroom()
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
