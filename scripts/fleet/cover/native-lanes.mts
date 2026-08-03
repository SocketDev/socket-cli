/*
 * @file Native-lane orchestration for the fleet coverage runner. `cover.mts`
 *   calls exactly one function here, `runNativeLanes`, and reports what it
 *   hands back, so every native-lane decision lives in this module instead of
 *   growing a runner that already sits past the file-size soft cap. Three jobs:
 *
 *   1. Run the repo's active native lanes, one at a time, through the injected
 *      command runner.
 *   2. Fold their line counts into one native-only tally plus the aligned
 *      per-lane breakdown the cover output prints.
 *   3. Persist `lane-summary.json`, the artifact the coverage-lanes-are-wired
 *      check reads.
 *
 *   The invariant every piece serves: a lane never disappears quietly. A lane
 *   whose toolchain is absent reports an explicit skip and STILL prints a
 *   SKIPPED line; a lane that declared a capability and then measured nothing
 *   exits non-zero, a call the lane itself owns — see ./lane-contract.mts. A
 *   lane missing from the output reads as "nothing here to measure", which is
 *   half a false-green.
 *   A repo with no native lanes pays nothing: the active set is empty, so no
 *   directory is created, no command runs, and the outcome is empty.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { isPlainObject } from '@socketsecurity/lib-stable/objects/predicates'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { writeThroughMirrorLock } from '../_shared/mirror-lock.mts'
import {
  readSocketWheelhouseConfigObject,
  resolveActiveLanes,
} from './lanes.mts'
import type { ActiveLane } from './lanes.mts'
import type {
  LaneCapability,
  LaneCommandRunner,
  LaneLogger,
  LaneResult,
  NativeLaneId,
} from './lane-contract.mts'

/**
 * A line tally and its rendered percentage. One shape for the native-only
 * tally and for the native-plus-TypeScript fold, so the two numbers can never
 * be formatted differently.
 */
export interface LaneLineTotals {
  covered: number
  pct: string
  total: number
}

/**
 * One lane's row in the persisted artifact. `detailPath` and `skippedReason`
 * are the two halves of "what happened": a measured lane names its detail
 * report, a skipped lane names why it stood down.
 */
export interface LaneSummaryEntry {
  capability: LaneCapability
  covered: number
  detailPath: string | undefined
  laneId: NativeLaneId
  measured: boolean
  pct: string
  skippedReason: string | undefined
  total: number
}

/**
 * The `lane-summary.json` payload. The coverage-lanes-are-wired check reads
 * this file to prove a declared lane actually ran, so it records every lane the
 * run touched, skipped ones included. `lanes` is keyed by lane id (`rust` /
 * `go` / `cpp`), the SAME shape the check's `readLaneEntry` looks a lane up by;
 * a plain array here would make the gate read nothing and go inert.
 */
export interface LaneSummaryArtifact {
  generatedAt: string
  lanes: Record<string, LaneSummaryEntry>
}

/**
 * What each lane needs to do its work. `runner` and `logger` are injected so a
 * test drives the whole fold without spawning a toolchain.
 */
export interface NativeLaneRunContext {
  detailDir: string
  logger: LaneLogger
  repoRoot: string
  runner: LaneCommandRunner
  scratchDir: string
}

/**
 * Everything `cover.mts` needs from part A. `combined` is the NATIVE-ONLY line
 * tally, the sum of covered lines over the sum of total lines across measured
 * lanes; it is undefined when no lane measured, which is how a skip-only run
 * stays out of the combined percentage instead of dragging it to zero.
 */
export interface NativeLanesOutcome {
  breakdownLines: string[]
  combined: LaneLineTotals | undefined
  exitCode: number
  results: LaneResult[]
}

/**
 * The real spawn behind a native lane: `cargo`, `go`, or the repo's cpp
 * delegate, invoked DIRECTLY rather than through the pnpm-wrapped `runQuiet`
 * the vitest suites use. `runQuiet` prefixes every command with pnpm, which
 * would turn `cargo llvm-cov` into `pnpm cargo llvm-cov` and fail before a
 * single line was measured.
 *
 * A spawn that cannot start at all THROWS, and each lane catches that around
 * its tool probe to report an explicit skip. Swallowing it into an exit code
 * here would erase the difference between "the toolchain is absent" and "the
 * toolchain ran and failed", the two outcomes a lane must keep apart.
 */
export const defaultLaneCommandRunner: LaneCommandRunner = async (
  cmd,
  args,
  config,
) => {
  const cfg = { __proto__: null, ...config } as typeof config
  const result = await spawn(cmd, args, {
    cwd: cfg.cwd,
    ...(cfg.env ? { env: cfg.env } : {}),
  })
  return {
    exitCode: result.code ?? 0,
    stderr: String(result.stderr ?? ''),
    stdout: String(result.stdout ?? ''),
  }
}

/**
 * Fold the TypeScript line counts and the native line counts into the single
 * combined line percentage the badge shows. Either side may be missing: a
 * native-only or bun-only repo has no TypeScript tally, and a TypeScript-only
 * repo has no native one. Undefined when neither side measured anything.
 */
export function combineWithTsLines(
  ts: { coveredLines: number; totalLines: number } | undefined,
  native: LaneLineTotals | undefined,
): LaneLineTotals | undefined {
  if (!ts && !native) {
    return undefined
  }
  const covered = (ts?.coveredLines ?? 0) + (native?.covered ?? 0)
  const total = (ts?.totalLines ?? 0) + (native?.total ?? 0)
  return { covered, pct: formatCoveragePct(covered, total), total }
}

/**
 * The fleet's one line-percentage convention, two decimals, matching the `pct`
 * helper in ../util/coverage-merge.mts so a native number and a TypeScript
 * number never render differently. A zero denominator reads as 0.00 rather than
 * NaN.
 */
export function formatCoveragePct(covered: number, total: number): string {
  return total > 0 ? ((covered / total) * 100).toFixed(2) : '0.00'
}

/**
 * A lane result's line counts. The contract in ./lane-contract.mts carries them
 * nested under `summary`, which is undefined for a lane that produced no report
 * at all; that reads as 0/0 here, and 0/0 is the collected-nothing signal the
 * lane itself already turned into a non-zero exit.
 */
export function laneLineCounts(result: LaneResult): {
  covered: number
  total: number
} {
  return {
    covered: result.summary?.covered ?? 0,
    total: result.summary?.total ?? 0,
  }
}

/**
 * One line per lane for the cover output, left-aligned on the widest lane id so
 * the numbers stack in a column. A measured lane prints its percentage, its raw
 * counts, and the repo-relative path to its detail report; a skipped lane
 * prints SKIPPED and the reason.
 * A skip line ALWAYS prints. Dropping the line for a lane that stood down is
 * how a run silently stops measuring a whole language, so a lane with no
 * reported reason still gets a row saying so.
 */
export function laneBreakdownLines(
  repoRoot: string,
  results: readonly LaneResult[],
): string[] {
  let width = 0
  for (let i = 0, { length } = results; i < length; i += 1) {
    width = Math.max(width, results[i]!.laneId.length)
  }
  const lines: string[] = []
  for (let i = 0, { length } = results; i < length; i += 1) {
    const result = results[i]!
    const label = result.laneId.padEnd(width, ' ')
    if (!result.measured) {
      lines.push(
        `  ${label}  SKIPPED — ${result.skippedReason ?? 'no reason reported'}`,
      )
      continue
    }
    const { covered, total } = laneLineCounts(result)
    const pct = formatCoveragePct(covered, total)
    const counts = `(${covered}/${total})`
    const detail = result.detailPath
      ? `  detail: ${normalizePath(path.relative(repoRoot, result.detailPath))}`
      : ''
    lines.push(`  ${label}  lines: ${pct}% ${counts}${detail}`)
  }
  return lines
}

/**
 * The native-only line tally: covered lines summed over total lines summed,
 * across MEASURED lanes only. Undefined when no lane measured, so a run where
 * every lane skipped reports "no native coverage" instead of 0.00%.
 */
export function nativeLineTotals(
  results: readonly LaneResult[],
): LaneLineTotals | undefined {
  let covered = 0
  let measuredLanes = 0
  let total = 0
  for (let i = 0, { length } = results; i < length; i += 1) {
    const result = results[i]!
    if (!result.measured) {
      continue
    }
    const counts = laneLineCounts(result)
    covered += counts.covered
    measuredLanes += 1
    total += counts.total
  }
  if (measuredLanes === 0) {
    return undefined
  }
  return { covered, pct: formatCoveragePct(covered, total), total }
}

/**
 * Write the lane-summary artifact the coverage-lanes-are-wired check reads.
 * Written through the mirror lock, the same way the bun lane writes the badge
 * summary, because a read-only fleet mirror EACCESes a plain write. Returns the
 * path so the caller can name the file it produced.
 */
export function persistLaneSummary(
  coverageDir: string,
  outcome: NativeLanesOutcome,
): string {
  const summaryPath = path.join(coverageDir, 'lane-summary.json')
  const lanes: Record<string, LaneSummaryEntry> = {}
  for (let i = 0, { length } = outcome.results; i < length; i += 1) {
    const result = outcome.results[i]!
    const { covered, total } = laneLineCounts(result)
    lanes[result.laneId] = {
      capability: result.capability,
      covered,
      detailPath: result.detailPath,
      laneId: result.laneId,
      measured: result.measured,
      pct: formatCoveragePct(covered, total),
      skippedReason: result.skippedReason,
      total,
    }
  }
  const artifact: LaneSummaryArtifact = {
    generatedAt: new Date().toISOString(),
    lanes,
  }
  mkdirSync(coverageDir, { recursive: true })
  writeThroughMirrorLock(
    summaryPath,
    `${JSON.stringify(artifact, undefined, 2)}\n`,
  )
  return summaryPath
}

/**
 * Point `total.lines.pct` in coverage-summary.json at the combined number.
 * Statements, branches, and functions stay untouched: no native coverage tool
 * reports them in the istanbul sense, so they remain TypeScript-only metrics.
 * A missing file is created with just the lines total — the bun lane writes its
 * own full shape first when it runs, and a native-only repo has no earlier
 * writer.
 */
export function rewriteSummaryLines(
  summaryPath: string,
  combinedPct: string,
): void {
  let parsed: unknown
  if (existsSync(summaryPath)) {
    parsed = JSON.parse(readFileSync(summaryPath, 'utf8'))
  }
  const summary: Record<string, unknown> = isPlainObject(parsed)
    ? { ...parsed }
    : {}
  const totalValue = summary['total']
  const total: Record<string, unknown> = isPlainObject(totalValue)
    ? { ...totalValue }
    : {}
  const linesValue = total['lines']
  const lines: Record<string, unknown> = isPlainObject(linesValue)
    ? { ...linesValue }
    : {}
  lines['pct'] = Number(combinedPct)
  total['lines'] = lines
  summary['total'] = total
  mkdirSync(path.dirname(summaryPath), { recursive: true })
  writeThroughMirrorLock(
    summaryPath,
    `${JSON.stringify(summary, undefined, 2)}\n`,
  )
}

/**
 * Run an explicit lane list and fold the results. This is the seam a test
 * drives with stub lanes; `runNativeLanes` is the same fold with the active set
 * resolved from the repo config.
 * Lanes run SEQUENTIALLY on purpose. Each native lane saturates every core —
 * cargo-llvm-cov builds and runs the whole crate graph, `go test` fans out
 * across packages — so running cargo and go together double-thrashes the
 * machine, finishes slower than the sequence, and makes both lanes' timings
 * noise.
 */
export async function runLanesSequentially(
  lanes: readonly ActiveLane[],
  context: NativeLaneRunContext,
): Promise<NativeLanesOutcome> {
  if (lanes.length === 0) {
    // A TypeScript-only repo pays nothing: no directory, no command, no
    // artifact rows.
    return { breakdownLines: [], combined: undefined, exitCode: 0, results: [] }
  }
  mkdirSync(context.detailDir, { recursive: true })
  mkdirSync(context.scratchDir, { recursive: true })
  const results: LaneResult[] = []
  let exitCode = 0
  for (let i = 0, { length } = lanes; i < length; i += 1) {
    // Each active lane measures the paths IT declared, so the shared context
    // is widened per lane rather than carrying one repo-wide path list.
    const { lane, paths } = lanes[i]!
    const result = await lane.run({ ...context, paths })
    results.push(result)
    // The FIRST non-zero lane exit wins, so a later green lane cannot mask an
    // earlier failure and the real code survives to the caller.
    exitCode = exitCode === 0 ? result.exitCode : exitCode
  }
  return {
    breakdownLines: laneBreakdownLines(context.repoRoot, results),
    combined: nativeLineTotals(results),
    exitCode,
    results,
  }
}

/**
 * Part A of the coverage run: resolve the repo's active native lanes and run
 * them. `repoConfig` is injectable so a test drives resolution without a
 * socket-wheelhouse.json on disk; the default reads the live one.
 */
export async function runNativeLanes(config: {
  detailDir: string
  logger: LaneLogger
  // oxlint-disable-next-line typescript/no-redundant-type-constituents -- fleet optional-explicit-undefined convention: the explicit | undefined on an optional is intentional, not redundant.
  repoConfig?: unknown | undefined
  repoRoot: string
  runner: LaneCommandRunner
  scratchDir: string
}): Promise<NativeLanesOutcome> {
  const cfg = { __proto__: null, ...config } as typeof config
  const repoConfig =
    cfg.repoConfig ?? readSocketWheelhouseConfigObject(cfg.repoRoot)
  return await runLanesSequentially(resolveActiveLanes(repoConfig), {
    detailDir: cfg.detailDir,
    logger: cfg.logger,
    repoRoot: cfg.repoRoot,
    runner: cfg.runner,
    scratchDir: cfg.scratchDir,
  })
}
