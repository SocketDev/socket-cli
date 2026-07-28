/**
 * @file Coverage runner execution helpers — source-map build, run-plan
 *   resolution, suite spawning, live-actor/churn evidence, subprocess
 *   coverage conversion, and the heap-headroom re-exec. Internal
 *   implementation detail for scripts/fleet/cover.mts, which re-exports each
 *   helper under its public name (tests import them from cover.mts) — split
 *   out so cover.mts stays under the fleet's file-size cap.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import {
  spawn,
  spawnSync,
} from '@socketsecurity/lib-stable/process/spawn/child'

import { sleep } from './_shared/backoff.mts'
import type { CoverConfig, ResolvedSuite } from './cover/discovery.mts'
import {
  readCoverConfig,
  resolveBuildEntry,
  resolveSuites,
} from './cover/discovery.mts'
import {
  COVERAGE_CHILDREN_RAW_DIR,
  COVERAGE_DIR,
  COVERAGE_FINAL_CHILDREN_PATH,
  COVERAGE_FINAL_ISOLATED_PATH,
  COVERAGE_FINAL_MAIN_PATH,
  COVERAGE_SCRATCH_DIR,
  COVERAGE_SCRATCH_VITEST_DIR,
  REPO_ROOT,
} from './paths.mts'
import { resolveCoverageConfig } from '../../.config/fleet/vitest.coverage.fleet.config.mts'
import type { EnvSnapshot, SuiteResult, TestSuitesResult } from './cover.mts'

const rootPath = REPO_ROOT

const logger = getDefaultLogger()

// Run a command quietly, capturing stdout/stderr and never throwing — a
// non-zero exit becomes an exitCode in the returned result so callers can still
// parse coverage output. Replaces the old repo-local run-command helper with a
// direct lib-stable spawn so the runner is self-contained and cascade-portable.
export async function runQuietCommand(
  args: string[],
  config: { cwd: string; env?: NodeJS.ProcessEnv | undefined },
): Promise<SuiteResult> {
  config = { __proto__: null, ...config } as typeof config
  try {
    // A pnpm shim can select a different `node` from PATH than the runtime
    // executing this coverage process. Prefer pnpm's JS entrypoint so the test
    // children stay on this exact Node, and lead PATH with the same binary dir
    // because `pnpm exec` launches local Node CLIs by name.
    const pnpmEntry = process.env['npm_execpath']
    const pnpmEntryIsJavaScript = /\.(?:cjs|js|mjs)$/u.test(pnpmEntry ?? '')
    const command = pnpmEntryIsJavaScript ? process.execPath : 'pnpm'
    const commandArgs = pnpmEntryIsJavaScript ? [pnpmEntry!, ...args] : args
    const env = config.env ?? process.env
    const nodeBin = path.dirname(process.execPath)
    const result = await spawn(command, commandArgs, {
      cwd: config.cwd,
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

// Move a vitest tier's throwaway scratch `coverage-final.json` to its flat
// per-tier path in COVERAGE_DIR. The next tier's `clean: true` wipes the scratch
// report, so each tier's result must be lifted out before the next runs. copy
// not rename, since scratch lives in os.tmpdir, possibly on another device.
// Returns whether a report was present to persist.
function persistScratchFinal(destPath: string): boolean {
  const scratchFinal = path.join(
    COVERAGE_SCRATCH_VITEST_DIR,
    'coverage-final.json',
  )
  if (!existsSync(scratchFinal)) {
    return false
  }
  mkdirSync(path.dirname(destPath), { recursive: true })
  copyFileSync(scratchFinal, destPath)
  return true
}

// Run the main suite and, when isolatedArgs is provided, the isolated suite.
// Returns individual results plus a combined view; isolatedResult is undefined
// when the repo ships no isolated suite.
export async function executeTestSuites(
  mainArgs: string[],
  isolatedArgs: string[] | undefined,
): Promise<TestSuitesResult> {
  // Subprocess coverage capture: the fleet vitest setup bridges this variable
  // into NODE_V8_COVERAGE inside each worker (workers read it only at process
  // START, so they never dump their own coverage) and every node child the
  // tests spawn inherits it, writing raw V8 coverage here on exit. c8 converts
  // the raw dir after the suites finish (buildChildrenCoverageReport).
  // Wipe the whole transient scratch first (prior run's raw child dumps + tier
  // reports): the raw dir otherwise accumulates tens of thousands of files
  // (multiple GB) across runs, and the merge loads it all into memory at once —
  // a stale pile OOMs the process. children-raw is a SIBLING of the vitest
  // scratch subdir, so a tier's `clean: true` can't wipe it mid-accumulation.
  const childRawDir = COVERAGE_CHILDREN_RAW_DIR
  safeDeleteSync(COVERAGE_SCRATCH_DIR, { force: true, recursive: true })
  mkdirSync(childRawDir, { recursive: true })
  mkdirSync(COVERAGE_DIR, { recursive: true })
  const run = (args: string[]): Promise<SuiteResult> =>
    runQuietCommand(args, {
      cwd: rootPath,
      env: {
        ...process.env,
        COVERAGE: 'true',
        FLEET_CHILD_V8_COVERAGE_DIR: childRawDir,
      },
    })

  const mainResult = await run(mainArgs)
  // Lift main's report out before the isolated tier's clean:true wipes it.
  persistScratchFinal(COVERAGE_FINAL_MAIN_PATH)
  const isolatedResult = isolatedArgs ? await run(isolatedArgs) : undefined
  if (isolatedArgs) {
    persistScratchFinal(COVERAGE_FINAL_ISOLATED_PATH)
  }

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

// Five coverage baselines were corrupted by concurrent activity before the
// evidence trail existed: a parallel session's live edits mid-run (73
// phantom failures), a mid-run pnpm install that transiently gutted module
// resolution (235 phantom import errors), and load-starved child spawns.
// The two helpers below make that churn VISIBLE: announce live foreign
// actors at startup, snapshot the install state, and stamp any failure
// with what changed during the run — a poisoned baseline names its
// poisoner instead of reading as 20+ regressions.
export function captureEnvSnapshot(): EnvSnapshot {
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
export function collectLiveActorNotes(windowMs: number): string[] {
  const out: string[] = []
  try {
    const dir = path.join(
      rootPath,
      'node_modules',
      '.cache',
      'fleet',
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

export function collectChurnNotes(snapshot: EnvSnapshot): string[] {
  const now = captureEnvSnapshot()
  const out: string[] = []
  if (now.lockfileMtimeMs !== snapshot.lockfileMtimeMs) {
    out.push('pnpm-lock.yaml CHANGED during the run (a concurrent install).')
  }
  if (pnpmDirChurned(snapshot, now)) {
    out.push(
      'node_modules/.pnpm CHANGED during the run — module resolution may have been transiently broken for spawned workers.',
    )
  }
  for (const line of collectLiveActorNotes(Date.now() - snapshot.startedAt)) {
    out.push(`live during the run: ${line}`)
  }
  return out
}

// Pure churn detection over a before/after install-state snapshot pair: TRUE
// when node_modules/.pnpm moved between the two. That directory turning over is
// the signal that a concurrent install re-linked deps mid-run, so module
// resolution may have been transiently broken for the spawned test workers — a
// failure observed across that window is inconclusive, not necessarily a
// regression.
export function pnpmDirChurned(
  before: EnvSnapshot,
  after: EnvSnapshot,
): boolean {
  return before.pnpmDirMtimeMs !== after.pnpmDirMtimeMs
}

/**
 * Count the raw v8 coverage dumps captured during the suites — the subprocess
 * children-raw dir plus the vitest tiers' raw `.tmp`. A positive count means
 * test workers/children DID execute and dumped v8 profiles, so a subsequently
 * empty merged report is a v8→istanbul conversion failure (a false-green
 * 0.00%), not a real 0% codebase. Best-effort per dir — a missing or unreadable
 * dir contributes nothing. Must be read BEFORE the conversion, which consumes
 * and deletes, the children-raw dir.
 */
export function countRawV8Profiles(
  dirs?: readonly string[] | undefined,
): number {
  let count = 0
  const searchDirs = dirs ?? [
    COVERAGE_CHILDREN_RAW_DIR,
    path.join(COVERAGE_SCRATCH_VITEST_DIR, '.tmp'),
  ]
  for (let i = 0, { length } = searchDirs; i < length; i += 1) {
    try {
      const entries = readdirSync(searchDirs[i]!)
      for (let j = 0, { length: elen } = entries; j < elen; j += 1) {
        if (entries[j]!.endsWith('.json')) {
          count += 1
        }
      }
    } catch {
      // Missing/unreadable dir — contributes nothing.
    }
  }
  return count
}

export interface EmptyConversionDecision {
  readonly hasMeasurableStatements: boolean
  readonly rawProfileCount: number
}

/**
 * TRUE = the coverage false-green: raw v8 profiles WERE captured but the
 * v8→istanbul conversion produced a report with no measurable statements. That
 * combination is a conversion failure (typically a mid-run node_modules/.pnpm
 * churn that transiently broke module resolution for the converter), NOT a real
 * 0% codebase. Precisely distinguished from the two sane 0-ish states so
 * neither false-alarms:
 *
 * - Genuine 0% covered: the merged report HAS statements (hasMeasurableStatements
 *   true), just none executed → returns false.
 * - Genuinely empty scope: NO raw profiles were captured (rawProfileCount 0) →
 *   returns false.
 */
export function isConversionEmptyDespiteProfiles(
  decision: EmptyConversionDecision,
): boolean {
  return decision.rawProfileCount > 0 && !decision.hasMeasurableStatements
}

export interface EmptyConversionRetryDecision {
  readonly attempt: number
  readonly conversionEmpty: boolean
  readonly maxAttempts: number
}

/**
 * Retry when the conversion came back empty-despite-profiles and the attempt
 * budget is not yet spent. A re-run regenerates the raw v8 profiles AND
 * reconverts, which resolves a churn-corrupted conversion; an exhausted budget
 * stops the loop so the runner fails LOUD instead of spinning forever.
 * `attempt` is 1-based; `maxAttempts` is the shared run budget.
 */
export function shouldRetryForEmptyConversion(
  decision: EmptyConversionRetryDecision,
): boolean {
  return decision.conversionEmpty && decision.attempt < decision.maxAttempts
}

export interface ChurnRetryDecision {
  readonly attempt: number
  readonly churnedDuringRun: boolean
  readonly failed: boolean
  readonly maxAttempts: number
}

// Pure retry decision for a cover suite run. Retry ONLY when the suite failed
// AND that run overlapped concurrent node_modules/.pnpm churn (the failure is
// inconclusive) AND the attempt budget is not yet spent. A churn-free failure
// is a genuine failure and is never retried; a passing run is never retried;
// and an exhausted budget stops the loop so a repo under sustained churn can't
// spin forever. `attempt` is 1-based; `maxAttempts` is the total run budget
// (initial run + retries).
export function shouldRetryForChurn(decision: ChurnRetryDecision): boolean {
  const { attempt, churnedDuringRun, failed, maxAttempts } = decision
  if (!failed || !churnedDuringRun) {
    return false
  }
  return attempt < maxAttempts
}

// Injected clock / mtime probe / sleep so the quiescence wait is unit-testable
// without real timing or a real filesystem.
export interface QuiescenceDeps {
  now: () => number
  pnpmDirMtimeMs: () => number
  sleep: (ms: number) => Promise<void>
}

export interface QuiescenceOptions {
  maxWaitMs?: number | undefined
  quietMs?: number | undefined
  sampleMs?: number | undefined
}

// Production quiescence deps: real clock + sleep, real node_modules/.pnpm mtime.
function realQuiescenceDeps(): QuiescenceDeps {
  const pnpmDir = path.join(rootPath, 'node_modules', '.pnpm')
  return {
    now: () => Date.now(),
    pnpmDirMtimeMs: () => {
      try {
        return statSync(pnpmDir).mtimeMs
      } catch {
        return 0
      }
    },
    sleep: ms => sleep(ms),
  }
}

/**
 * Wait until node_modules/.pnpm has settled — its mtime unchanged for a
 * quiescence window — before a churn-inconclusive suite is re-run, so the retry
 * doesn't race a still-in-flight concurrent install. Samples the mtime every
 * `sampleMs`; each observed change resets the quiet timer. Returns TRUE once
 * the dir stays quiet for `quietMs`, or FALSE at the `maxWaitMs` cap. BOUNDED
 * by design: it never blocks forever, so a repo under sustained churn still
 * makes progress (the caller retries against a best-effort-settled tree, and an
 * exhausted attempt budget is still fatal).
 */
export async function waitForPnpmQuiescence(
  deps: QuiescenceDeps = realQuiescenceDeps(),
  options?: QuiescenceOptions | undefined,
): Promise<boolean> {
  const opts = { __proto__: null, ...options } as QuiescenceOptions
  const sampleMs = opts.sampleMs ?? 250
  const quietMs = opts.quietMs ?? 1000
  const maxWaitMs = opts.maxWaitMs ?? 15_000
  const start = deps.now()
  let lastMtime = deps.pnpmDirMtimeMs()
  let quietSince = deps.now()
  while (deps.now() - start < maxWaitMs) {
    // eslint-disable-next-line no-await-in-loop
    await deps.sleep(sampleMs)
    const mtime = deps.pnpmDirMtimeMs()
    if (mtime !== lastMtime) {
      lastMtime = mtime
      quietSince = deps.now()
      continue
    }
    if (deps.now() - quietSince >= quietMs) {
      return true
    }
  }
  return false
}

// Thrown when the subprocess coverage capture is PROVABLY incomplete at the
// drain timeout — the raw-fragment dir is still growing, or a fragment is
// truncated, a child was mid-write when read. Failing loud is deliberate:
// silently merging a partial capture under-reports the aggregate (a coverage
// false-red that flips on runner timing). See drainChildFragments.
export class IncompleteChildCaptureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IncompleteChildCaptureError'
  }
}

// A raw NODE_V8_COVERAGE fragment is a complete JSON document; a file still
// being written parses as incomplete. Used by the drain to distinguish "still
// flushing" from "settled". Empty → not yet complete.
export function isCompleteJsonFragment(content: string): boolean {
  if (content.length === 0) {
    return false
  }
  try {
    JSON.parse(content)
    return true
  } catch {
    return false
  }
}

// Injected I/O + clock so the drain is unit-testable without real timing.
export interface DrainChildDeps {
  listFragments: () => string[]
  now: () => number
  readFragment: (name: string) => string
  sizeOf: (name: string) => number
  sleep: (ms: number) => Promise<void>
}

export interface DrainChildOptions {
  maxWaitMs?: number | undefined
  quietSamples?: number | undefined
  sampleMs?: number | undefined
}

interface FragmentSnapshot {
  count: number
  names: string[]
  totalSize: number
}

function snapshotFragments(deps: DrainChildDeps): FragmentSnapshot {
  const names = deps.listFragments()
  let totalSize = 0
  for (let i = 0, { length } = names; i < length; i += 1) {
    totalSize += deps.sizeOf(names[i]!)
  }
  return { count: names.length, names, totalSize }
}

function allFragmentsComplete(deps: DrainChildDeps, names: string[]): boolean {
  for (let i = 0, { length } = names; i < length; i += 1) {
    if (!isCompleteJsonFragment(deps.readFragment(names[i]!))) {
      return false
    }
  }
  return true
}

function fragmentsStable(a: FragmentSnapshot, b: FragmentSnapshot): boolean {
  return a.count === b.count && a.totalSize === b.totalSize
}

/**
 * Drain the raw child-fragment dir to a SETTLED state before the merge reads
 * it. A slower runner (CI, fewer cores) can reach the merge while a just-exited
 * child is still flushing its NODE_V8_COVERAGE file, so the merge captures a
 * VARIABLE subset — under-reporting the aggregate on runner timing alone. This
 * waits until the fragment set is stable (count + total size unchanged) AND
 * every fragment parses as complete JSON, across `quietSamples` consecutive
 * samples, hard-capped at `maxWaitMs`. Returns the settled fragment count.
 *
 * FAIL LOUD: if the cap is hit while the dir is STILL growing or a fragment is
 * truncated, throw IncompleteChildCaptureError rather than merge a partial —
 * never silently report a low aggregate. Conservative: if the final observed
 * state is stable + complete, just short of the quiet streak, it ACCEPTS
 * rather than false-red a genuinely settled dir.
 *
 * Honest limit: a child SIGKILLed on a test-timeout wrote no fragment at all,
 * so it can never be "waited for" here — those lines stay uncovered (a
 * test-budget issue, surfaced by the capture-count visibility, not this drain).
 */
export async function drainChildFragments(
  deps: DrainChildDeps,
  options?: DrainChildOptions | undefined,
): Promise<number> {
  const opts = { __proto__: null, ...options } as DrainChildOptions
  const sampleMs = opts.sampleMs ?? 250
  const quietSamples = opts.quietSamples ?? 3
  const maxWaitMs = opts.maxWaitMs ?? 10_000
  const start = deps.now()
  let prev = snapshotFragments(deps)
  let stableStreak = 0
  // The last observed sample's verdict — read at the cap so "still growing" is
  // decided by the final loop comparison (a post-loop re-snapshot would equal
  // `prev`, hiding growth). An empty dir is settled at count 0.
  let lastStable = true
  let lastComplete = allFragmentsComplete(deps, prev.names)
  while (deps.now() - start < maxWaitMs) {
    // eslint-disable-next-line no-await-in-loop
    await deps.sleep(sampleMs)
    const cur = snapshotFragments(deps)
    lastStable = fragmentsStable(prev, cur)
    lastComplete = allFragmentsComplete(deps, cur.names)
    if (lastStable && lastComplete) {
      stableStreak += 1
      if (stableStreak >= quietSamples) {
        return cur.count
      }
    } else {
      stableStreak = 0
    }
    prev = cur
  }
  // Cap hit — fail only on PROVABLE incompleteness (conservative).
  if (!lastComplete) {
    throw new IncompleteChildCaptureError(
      `subprocess coverage capture incomplete: truncated fragment(s) after ${maxWaitMs}ms drain`,
    )
  }
  if (!lastStable) {
    throw new IncompleteChildCaptureError(
      `subprocess coverage capture incomplete: raw fragment dir still growing after ${maxWaitMs}ms drain`,
    )
  }
  // Stable + complete at the cap, just short of the quiet streak — accept it
  // rather than false-red a genuinely settled capture.
  return prev.count
}

// Production drain deps: real fs against the raw dir, real clock + sleep.
function realDrainDeps(rawDir: string): DrainChildDeps {
  return {
    listFragments: () => readdirSync(rawDir).filter(f => f.endsWith('.json')),
    now: () => Date.now(),
    readFragment: name => {
      try {
        return readFileSync(path.join(rawDir, name), 'utf8')
      } catch {
        return ''
      }
    },
    sizeOf: name => {
      try {
        return statSync(path.join(rawDir, name)).size
      } catch {
        return 0
      }
    },
    sleep: ms => sleep(ms),
  }
}

/**
 * Convert the raw NODE_V8_COVERAGE output spawned children wrote during the
 * suites into the children tier's coverage-final.json via c8's programmatic
 * Report API (the istanbul-org converter built for exactly this format; the
 * library path — its yargs-driven CLI shim does not load on Node 26).
 * Best-effort: no raw output or no c8 installed → skip with a note; the
 * merge simply proceeds without the children tier. Returns true when a
 * report was produced.
 */
export async function buildChildrenCoverageReport(): Promise<boolean> {
  const rawDir = COVERAGE_CHILDREN_RAW_DIR
  // Drain the raw dir to a settled capture BEFORE reading it, so a slow runner
  // doesn't merge while children are still flushing (fail-loud if the capture
  // is provably incomplete). Skipped when the dir doesn't exist yet.
  if (existsSync(rawDir)) {
    await drainChildFragments(realDrainDeps(rawDir))
  }
  const scratchReportDir = path.join(COVERAGE_SCRATCH_DIR, 'children')
  const rawFiles = existsSync(rawDir)
    ? readdirSync(rawDir).filter(f => f.endsWith('.json'))
    : []
  // ALWAYS surface the capture count (even 0) — this is the key CI-vs-local
  // diagnostic: a CI runner with fewer cores can capture fewer child fragments
  // than local, silently lowering the aggregate. Printed unconditionally so
  // every run (incl a failing CI cut) shows it via stdout / gh run --log.
  logger.info(
    `Subprocess coverage: captured ${rawFiles.length} raw child fragment(s).`,
  )
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
  mkdirSync(scratchReportDir, { recursive: true })
  await ReportCtor({
    exclude: coverageShape.exclude,
    excludeAfterRemap: true,
    // c8's default extension list omits .mts/.cts — without them every fleet
    // script is filtered out and the report comes back empty.
    extension: ['.js', '.cjs', '.mjs', '.ts', '.mts', '.cts', '.tsx', '.jsx'],
    include: coverageShape.include,
    reporter: ['json'],
    reportsDirectory: scratchReportDir,
    src: [rootPath],
    tempDirectory: rawDir,
  }).run()
  const scratchFinal = path.join(scratchReportDir, 'coverage-final.json')
  const produced = existsSync(scratchFinal)
  if (produced) {
    // Lift the converted report to the flat per-tier path in COVERAGE_DIR the
    // merge reads. Raw V8 profiles are a large intermediate (multiple GB in the
    // wheelhouse suite), so do not retain them until the next coverage run.
    mkdirSync(path.dirname(COVERAGE_FINAL_CHILDREN_PATH), { recursive: true })
    copyFileSync(scratchFinal, COVERAGE_FINAL_CHILDREN_PATH)
    safeDeleteSync(rawDir, { force: true, recursive: true })
    logger.info(
      `Merged subprocess coverage from ${rawFiles.length} spawned child process(es).`,
    )
  }
  return produced
}

// Build with source maps for coverage, repos that ship a build entry, so v8
// coverage maps back to original sources; repos with no build entry are
// instrumented directly. Returns whether the build failed.
export async function buildWithSourceMaps(repoRoot: string): Promise<boolean> {
  const buildEntry = resolveBuildEntry(repoRoot)
  if (!buildEntry) {
    logger.info(
      'No build entry (scripts/build.mts | bundle.mts) — instrumenting sources directly.',
    )
    logger.log('')
    return false
  }
  logger.info('Building with source maps for coverage…')
  const buildResult = await spawn('node', [buildEntry], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      COVERAGE: 'true',
    },
  })
  const buildFailed = buildResult.code !== 0
  if (buildFailed) {
    logger.error('Build with source maps failed')
    process.exitCode = 1
  }
  logger.log('')
  return buildFailed
}

export interface RunPlan {
  coverConfig: CoverConfig
  isolatedVitestArgs: string[] | undefined
  mainVitestArgs: string[]
  typeCoverageArgs: string[]
}

// Resolve the repo's cover config (the `cover` section of socket-wheelhouse.json),
// its resolved suites, and the vitest
// argv for each — threading a suite's per-run --exclude globs (so a test that
// exercises another package is skipped in this repo's coverage run).
export function resolveRunPlan(repoRoot: string): RunPlan {
  const customFlags = ['--code-only', '--type-only', '--summary']
  const passthroughArgs = process.argv
    .slice(2)
    .filter(arg => !customFlags.includes(arg))

  const coverConfig = readCoverConfig(repoRoot)
  const suites = resolveSuites(repoRoot, coverConfig)

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

  return {
    coverConfig,
    isolatedVitestArgs,
    mainVitestArgs,
    typeCoverageArgs: ['exec', 'type-coverage'],
  }
}

// The coverage merge holds every workspace project's coverage-final.json in
// memory at once; across a large workspace that exceeds node's default old-space
// ceiling and the parent process OOMs mid-merge (observed near 4 GB). Re-exec
// once with a raised heap — 75% of host RAM, floored at 4 GB, capped at 8 GB —
// before any work. The env guard prevents a re-exec loop; an already-raised
// --max-old-space-size (execArgv or NODE_OPTIONS) is left as the operator set it.
const HEAP_ELEVATED_ENV = 'FLEET_COVER_HEAP_ELEVATED'
export function reexecWithHeapHeadroom(entryPath: string): void {
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
    [`--max-old-space-size=${heapMb}`, entryPath, ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, [HEAP_ELEVATED_ENV]: '1' } },
  )
  process.exit(result.status ?? 1)
}
