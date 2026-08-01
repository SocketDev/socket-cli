/**
 * @file Coverage runner reporting helpers — threshold gating, output
 *   cleaning, unit-suite budget tracking, suite-failure explanation, and the
 *   terminal coverage display. Internal implementation detail for
 *   scripts/fleet/cover.mts, which re-exports each helper under its public
 *   name (tests import them from cover.mts) — split out so cover.mts stays
 *   under the fleet's file-size cap.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { stripAnsi } from '@socketsecurity/lib-stable/ansi/strip'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { writeThroughMirrorLock } from './_shared/mirror-lock.mts'
import type { CoverThresholds } from './cover/discovery.mts'
import { COVERAGE_FINAL_PATH, REPO_ROOT } from './paths.mts'
import { coveredCounts } from './util/coverage-merge.mts'
import type {
  AggregateCoverage,
  CoverageFileFinal,
} from './util/coverage-merge.mts'
import type { SuiteResult } from './cover.mts'

const rootPath = REPO_ROOT

const logger = getDefaultLogger()

// Compare merged aggregate coverage against configured thresholds. Returns the
// list of metrics that fell short, empty when all pass or no thresholds set.
export function computeThresholdFailures(
  aggregate: AggregateCoverage | undefined,
  thresholds: CoverThresholds | undefined,
): string[] {
  if (!thresholds) {
    return []
  }
  // Fail CLOSED: thresholds are configured, so a missing aggregate (e.g. a
  // tier clobbered its coverage-final.json before the merge read it)
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
// fleet-wide (the test helper at test/fleet/_shared/lib/output.mts wraps the
// same).
export function cleanOutputText(text: string): string {
  return stripAnsi(text)
    .replace(/(?:⚡|✧|︎)\s*/g, '')
    .trim()
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
export function resolveConfiguredUnitBudgetMs(): number {
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
export function evaluateBudgetOverrun(
  suiteMs: number,
  budgetMs: number,
): boolean {
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
 * LIVE wall-clock watchdog for the unit suites. `evaluateBudgetOverrun` only
 * fires AFTER the suites return, which is useless in the case that actually
 * burns an operator: a suite that HANGS (a stuck child spawn, a missing nock
 * mock blocking on a real socket — tests fail-closed on network, an infinite
 * loop) never completes, so the post-hoc check never runs and whoever
 * launched it waits blind. This fires WHILE the run is live — at the budget,
 * then again each budget interval — telling them to INVESTIGATE rather than
 * keep waiting. It never kills the run: a legitimately heavy suite still
 * finishes and the nag is just noise; a wedged one becomes visible instead of
 * silent. The timer is `unref`'d so a clean finish exits immediately with no
 * pending-tick delay. Returns a disposer that clears it (call from a
 * `finally`).
 */
export function armUnitBudgetWatchdog(budgetMs: number): () => void {
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

export function parseTypeCoveragePercentValue(
  output: string,
): number | undefined {
  // Extracts a floating-point percentage from type-coverage output.
  // \( ... \)  — literal parens wrapping the fraction, e.g. "(123 / 456)"
  // [\d\s/]+   — digits, spaces, and "/" inside the parens
  // \s+        — whitespace separator between fraction and percentage
  // ([\d.]+)%  — capture group 1: the percentage digits before the "%" sign
  const match = output.match(/\([\d\s/]+\)\s+([\d.]+)%/)
  return match?.[1] ? Number.parseFloat(match[1]) : undefined
}

// The 12-line summary below filters the suite output down to error-ish
// lines, which hides the real diagnostic when a worker dies mid-run (a heap
// OOM abort, a SIGKILL, a vanished v8 report). Persist the COMPLETE output
// where the operator can read it; a masked failure is a silent strand.
function persistSuiteFailureOutput(
  name: string,
  result: SuiteResult,
): string | undefined {
  try {
    const dir = path.join(rootPath, '.cache', 'fleet', 'fleet-cover')
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `last-failure-${name}.log`)
    writeThroughMirrorLock(
      file,
      `exit ${result.exitCode}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}\n`,
    )
    return file
  } catch {
    return undefined
  }
}

// Pull the FAILING test-file paths out of vitest's buffered output. cover runs
// vitest buffered (runQuietCommand), so a below-threshold / test-failure cut
// only re-emits the summary — the failing FILE names never reach the CI log
// only the runner's inaccessible last-failure log. Two vitest markers name a
// failing file: the "FAIL <path>" failure header and the file-tree entry
// "❯ <path> (N tests | M failed)". The count/threshold lines give totals, not
// paths — so without this the gate says "2 failed" but never WHICH two. Pure +
// exported for unit testing.
export function extractFailingTestFiles(lines: readonly string[]): string[] {
  const fileToken = String.raw`(\S+\.(?:test|spec)\.[cm]?[jt]sx?)`
  const failHeader = new RegExp(String.raw`(?:^|\s)FAIL\s+${fileToken}`)
  const failTreeEntry = new RegExp(
    String.raw`❯\s+${fileToken}\s+\([^)]*\bfailed\)`,
  )
  const paths = new Set<string>()
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    const match = failHeader.exec(line) ?? failTreeEntry.exec(line)
    if (match?.[1]) {
      paths.add(match[1])
    }
  }
  return [...paths].toSorted()
}

// Explain a failing suite: vitest prints its per-config coverage-threshold
// misses (e.g. "ERROR: Coverage for branches (46.92%) does not meet global
// threshold (49%)") to the suite's own output, which the summary display
// filters out — a bare "Coverage failed" strands the operator without the
// failing metric. NAMES the failing test files up front (see
// extractFailingTestFiles), then returns the error-ish lines from the suite
// output, deduped, capped, falling back to the output tail; empty for a
// passing suite.
export function buildSuiteFailureReport(
  name: string,
  result: SuiteResult,
): string[] {
  if (result.exitCode === 0) {
    return []
  }
  const maxLines = 12
  const lines = cleanOutputText(result.stdout + result.stderr)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
  const errorLines = [
    ...new Set(
      lines.filter(line =>
        // `ERROR` keyword; vitest coverage threshold message ("does not meet"
        // / "threshold"); vitest final summary ("Tests N failed"); the vitest
        // per-file failure header ("FAIL <path>") and file-tree entry
        // ("❯ <path> (… | M failed)") that name WHICH files failed.
        /\bERROR\b|does not meet|threshold|Tests\s+\d+\s+failed|\bFAIL\b|\|\s*\d+\s+failed\)/i.test(
          line,
        ),
      ),
    ),
  ]
  const detail = (errorLines.length > 0 ? errorLines : lines.slice(-maxLines))
    .slice(0, maxLines)
    .map(line => `  ${line}`)
  const failingFiles = extractFailingTestFiles(lines)
  const dumpPath = persistSuiteFailureOutput(name, result)
  return [
    `${name} suite failed (exit ${result.exitCode}):`,
    ...(failingFiles.length > 0
      ? [`  failing file(s): ${failingFiles.join(', ')}`]
      : []),
    ...detail,
    ...(dumpPath ? [`  full suite output: ${dumpPath}`] : []),
  ]
}

// The N files with the most UNCOVERED branches in the merged coverage-final
// (skips test files + files with no branches). Pure read; returns [] on any
// read/parse failure so the caller stays best-effort.
export function topUncoveredBranchFiles(
  limit: number,
  finalPath: string = COVERAGE_FINAL_PATH,
): Array<{ file: string; covered: number; total: number; missing: number }> {
  let merged: Record<string, CoverageFileFinal>
  try {
    merged = JSON.parse(readFileSync(finalPath, 'utf8')) as Record<
      string,
      CoverageFileFinal
    >
  } catch {
    return []
  }
  const rows: Array<{
    file: string
    covered: number
    total: number
    missing: number
  }> = []
  for (const [abs, entry] of Object.entries(merged)) {
    const rel = normalizePath(path.relative(rootPath, abs))
    if (rel.endsWith('.test.mts') || /(?:^|\/)test\//.test(rel)) {
      continue
    }
    let total = 0
    const branchArrs = Object.values(entry?.b ?? {})
    for (let i = 0, { length } = branchArrs; i < length; i += 1) {
      total += branchArrs[i]!.length
    }
    if (total === 0) {
      continue
    }
    const { branches: covered } = coveredCounts(entry)
    const missing = total - covered
    if (missing > 0) {
      rows.push({ covered, file: rel, missing, total })
    }
  }
  rows.sort((a, b) => b.missing - a.missing)
  return rows.slice(0, limit)
}

// Visibility: echo the aggregate + the top uncovered-branch files to stdout AND
// when running under Actions, GITHUB_STEP_SUMMARY, so a CI cover run surfaces
// its real number + the biggest gaps. Pure logging — best-effort, never throws.
export function emitCoverageVisibility(aggregate: AggregateCoverage): void {
  const top = topUncoveredBranchFiles(5)
  if (top.length > 0) {
    logger.log('')
    logger.log(' Top uncovered-branch files:')
    for (let i = 0, { length } = top; i < length; i += 1) {
      const r = top[i]!
      logger.log(
        `   ${r.covered}/${r.total} branches — ${r.file} (${r.missing} uncovered)`,
      )
    }
  }
  const summaryPath = process.env['GITHUB_STEP_SUMMARY']
  if (!summaryPath) {
    return
  }
  const lines = [
    '### Aggregate code coverage (Main + Isolated)',
    '',
    `- Statements: ${aggregate.statements}%`,
    `- Branches: ${aggregate.branches}%`,
    `- Functions: ${aggregate.functions}%`,
    `- Lines: ${aggregate.lines}%`,
  ]
  if (top.length > 0) {
    lines.push('', '#### Top uncovered-branch files', '')
    for (let i = 0, { length } = top; i < length; i += 1) {
      const r = top[i]!
      lines.push(
        `- \`${r.file}\` — ${r.covered}/${r.total} branches (${r.missing} uncovered)`,
      )
    }
  }
  lines.push('')
  try {
    appendFileSync(summaryPath, `${lines.join('\n')}\n`)
  } catch {
    // Best-effort: a missing/unwritable step-summary file must not fail cover.
  }
}

// Print the test summary, optional v8 detail table, and the coverage summary.
export function renderCodeCoverageDisplay(
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
    // Visibility: echo the aggregate + the biggest uncovered-branch files to
    // stdout AND GITHUB_STEP_SUMMARY, so a CI cover run SHOWS its real number
    // and the top gaps instead of only failing a threshold. Pure logging — no
    // gating logic, best-effort (any read/write error is swallowed).
    emitCoverageVisibility(aggregateCoverage)
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
