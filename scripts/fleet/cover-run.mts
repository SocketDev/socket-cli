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
// (not rename) since scratch lives in os.tmpdir, possibly on another device.
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
  if (now.pnpmDirMtimeMs !== snapshot.pnpmDirMtimeMs) {
    out.push(
      'node_modules/.pnpm CHANGED during the run — module resolution may have been transiently broken for spawned workers.',
    )
  }
  for (const line of collectLiveActorNotes(Date.now() - snapshot.startedAt)) {
    out.push(`live during the run: ${line}`)
  }
  return out
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
  const scratchReportDir = path.join(COVERAGE_SCRATCH_DIR, 'children')
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

// Build with source maps for coverage (repos that ship a build entry) so v8
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

// Resolve the repo's cover.json config, its resolved suites, and the vitest
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
