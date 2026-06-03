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

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { printHeader } from '@socketsecurity/lib-stable/stdio/header'

import type { AggregateCoverage } from './util/coverage-merge.mts'
import { mergeCoverageFinal } from './util/coverage-merge.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// This script lives at scripts/fleet/, so the repo root is two levels up.
const rootPath = path.join(__dirname, '..', '..')

const logger = getDefaultLogger()

const ansiRegex = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

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

// Resolve a config basename repo-first: prefer `.config/repo/<name>`, fall back
// to the legacy top-level `.config/<name>`. Returns the repo-root-relative path
// vitest should load, or undefined when neither location has the file.
export function resolveConfig(basename: string): string | undefined {
  const candidates = [
    path.join('.config', 'repo', basename),
    path.join('.config', basename),
  ]
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const rel = candidates[i]!
    if (existsSync(path.join(rootPath, rel))) {
      return rel
    }
  }
  return undefined
}

// Standard fleet test-suite vocabulary. `shared` is the default shared-context
// suite (pool: threads); `isolated` is the full-isolation suite (forks) for
// tests that mock globals / chdir / mutate process.env. Each maps to a vitest
// config basename resolved repo-first.
export const SUITE_DEFAULTS: ReadonlyArray<{
  name: string
  configBasename: string
}> = [
  { name: 'shared', configBasename: 'vitest.config.mts' },
  { name: 'isolated', configBasename: 'vitest.config.isolated.mts' },
]

export interface CoverSuiteConfig {
  // Explicit config path override (repo-root-relative). Defaults to the
  // repo-first resolution of the suite's standard basename.
  config?: string | undefined
  // Globs passed as `vitest --exclude <glob>` for THIS suite's run — skips
  // running matching test files (e.g. a test that exercises another package
  // and would pollute this repo's coverage denominator).
  runExclude?: string[] | undefined
}

export interface CoverThresholds {
  statements?: number | undefined
  branches?: number | undefined
  functions?: number | undefined
  lines?: number | undefined
}

export interface CoverConfig {
  suites?: Record<string, CoverSuiteConfig> | undefined
  thresholds?: CoverThresholds | undefined
}

// Read the repo-owned cover config (`.config/repo/cover.json`, legacy
// `.config/cover.json` fallback). Returns an empty config when absent so
// callers get fleet defaults. A malformed file is reported and treated as
// empty rather than crashing the run.
export function readCoverConfig(): CoverConfig {
  const configPath = [
    path.join(rootPath, '.config', 'repo', 'cover.json'),
    path.join(rootPath, '.config', 'cover.json'),
  ].find(p => existsSync(p))
  if (!configPath) {
    return {}
  }
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object') {
      logger.warn(
        `${path.relative(rootPath, configPath)} must be a JSON object — ignoring`,
      )
      return {}
    }
    return parsed as CoverConfig
  } catch (e) {
    logger.warn(
      `Failed to parse ${path.relative(rootPath, configPath)}: ${errorMessage(e)} — ignoring`,
    )
    return {}
  }
}

export interface ResolvedSuite {
  name: string
  config: string | undefined
  runExclude: string[]
}

// Merge the fleet suite defaults with the repo's cover.json into the concrete
// list of suites to run. A suite runs when its config resolves (repo-first or
// explicit override). Per-suite runExclude comes from cover.json.
export function resolveSuites(coverConfig: CoverConfig): ResolvedSuite[] {
  const suiteConfigs = coverConfig.suites ?? {}
  const resolved: ResolvedSuite[] = []
  for (let i = 0, { length } = SUITE_DEFAULTS; i < length; i += 1) {
    const def = SUITE_DEFAULTS[i]!
    const override = suiteConfigs[def.name] ?? {}
    const config = override.config ?? resolveConfig(def.configBasename)
    if (!config) {
      continue
    }
    resolved.push({
      name: def.name,
      config,
      runExclude: override.runExclude ?? [],
    })
  }
  return resolved
}

// Compare merged aggregate coverage against configured thresholds. Returns the
// list of metrics that fell short (empty when all pass or no thresholds set).
export function checkThresholds(
  aggregate: AggregateCoverage | undefined,
  thresholds: CoverThresholds | undefined,
): string[] {
  if (!thresholds || !aggregate) {
    return []
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
// text.
export function cleanOutput(text: string): string {
  return text
    .replace(ansiRegex, '')
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
  try {
    const result = await spawn('pnpm', args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
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

export function parseTypeCoveragePercent(output: string): number | undefined {
  const match = output.match(/\([\d\s/]+\)\s+([\d.]+)%/)
  return match?.[1] ? Number.parseFloat(match[1]) : undefined
}

// Run the main suite and, when isolatedArgs is provided, the isolated suite.
// Returns individual results plus a combined view; isolatedResult is undefined
// when the repo ships no isolated suite.
export async function runTestSuites(
  mainArgs: string[],
  isolatedArgs: string[] | undefined,
): Promise<TestSuitesResult> {
  const run = (args: string[]): Promise<SuiteResult> =>
    runQuiet(args, {
      cwd: rootPath,
      env: { ...process.env, COVERAGE: 'true' },
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

export async function main(): Promise<void> {
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

  logger.info('Building with source maps for coverage…')
  const buildResult = await spawn('node', ['scripts/build.mts'], {
    cwd: rootPath,
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

  const customFlags = ['--code-only', '--type-only', '--summary']
  const passthroughArgs = process.argv
    .slice(2)
    .filter(arg => !customFlags.includes(arg))

  const coverConfig = readCoverConfig()
  const suites = resolveSuites(coverConfig)

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
      const { combined, mainResult } = await runTestSuites(
        mainVitestArgs,
        isolatedVitestArgs,
      )
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

      let aggregateCoverage: AggregateCoverage | undefined
      try {
        aggregateCoverage = await mergeCoverageFinal({ rootPath, logger })
      } catch (e) {
        logger.warn(
          `Could not compute aggregate coverage: ${e instanceof Error ? e.message : 'Unknown error'}`,
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

main().catch((e: unknown) => {
  logger.error(`Coverage script failed: ${errorMessage(e)}`)
  process.exitCode = 1
})
