/*
 * @file The uniform contract every NATIVE coverage lane implements — rust, go,
 *   cpp. It lives in its own module so a lane implementation never imports
 *   ./lanes.mts, which imports the lanes themselves. The dependency runs one
 *   direction only — contract → lane → registry — so adding a fourth lane
 *   touches the registry and nothing else, and there is no cycle to untangle.
 *   ACCEPTANCE BAR, and the reason the result type is shaped the way it is: a
 *   lane must NEVER report success while measuring nothing. Every run lands in
 *   exactly one of three outcomes —
 *
 *   1. THE TOOL IS ABSENT. `{ measured: false, skippedReason: '<tool> not found —
 *      install via <hint>', exitCode: 0 }`. An EXPLICIT skip the caller prints,
 *      never a silent pass: a machine without cargo-llvm-cov must read as "rust
 *      lane skipped", not as a green rust lane. `describeLaneToolAbsent` writes
 *      that line.
 *   2. THE TOOL RAN AND MEASURED. `{ measured: true, summary: <total > 0>,
 *      exitCode: <the tool's own exit code> }`. A lane never rewrites a failing
 *      tool exit code to 0.
 *   3. THE TOOL RAN AND MEASURED NOTHING while the capability declared paths — a
 *      missing report file, an empty one, or a zero line denominator. Then `{
 *      measured: true, summary: undefined-or-zero, exitCode: 1 }` plus the
 *      four-ingredient error from `describeLaneMeasuredNothing` on the
 *      context's logger. This is the false green the whole seam exists to make
 *      impossible: the repo's own config said "there is Rust here", so
 *      measuring zero lines of it is a failure, not a 0.00% pass. Same
 *      property, and the same message shape, as `describeEmptyCollection` in
 *      ./bun-lane.mts. Everything here is pure — no spawning, no filesystem. A
 *      lane takes its spawn and its logger from `LaneRunContext`, so a unit
 *      test can drive all three outcomes with no toolchain installed.
 */

import { parseLcov } from './runner.mts'
import type { LcovFileCoverage } from './runner.mts'

/**
 * A line-coverage roll-up. `pct` is a fixed-2 STRING ('87.50'), matching
 * `AggregateCoverage` in ../util/coverage-merge.mts, so a native lane's number
 * reaches the reporter in the same shape the JS lanes produce and nothing
 * downstream has to reformat it.
 */
export interface LineCoverage {
  covered: number
  total: number
  pct: string
}

export type NativeLaneId = 'rust' | 'go' | 'cpp'

export type LaneCapability = 'cargo' | 'go' | 'cpp'

/**
 * The capabilities that own a native lane, in RUN order — cargo, go, cpp — not
 * alphabetical order. The registry's dispatch and `readRepoCapabilities` both
 * iterate this one array, so a repo declaring all three always reports its
 * lanes in the same sequence and two runs stay diffable.
 *
 * This deliberately mirrors `VALID_CAPABILITIES` in
 * scripts/repo/sync-scaffolding/repo-shape.mts rather than importing it: a
 * fleet script cannot depend on a repo-owned module. The unit test imports both
 * and asserts they agree, which is what keeps the copy honest.
 */
export const LANE_CAPABILITIES: readonly LaneCapability[] = [
  'cargo',
  'go',
  'cpp',
]

export interface LaneCommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

/**
 * The spawn seam. A lane takes its runner from the run context instead of
 * importing a spawn helper directly, so a test drives the tool-absent,
 * measured, and measured-nothing branches without cargo, go, or a C++ compiler
 * on the machine.
 */
export interface LaneCommandRunner {
  (
    cmd: string,
    args: string[],
    config: { cwd: string; env?: NodeJS.ProcessEnv | undefined },
  ): Promise<LaneCommandResult>
}

export interface LaneLogger {
  error(m: string): void
  warn(m: string): void
  log(m: string): void
}

export interface LaneRunContext {
  paths: readonly string[]
  repoRoot: string
  scratchDir: string
  detailDir: string
  runner: LaneCommandRunner
  logger: LaneLogger
}

export interface LaneResult {
  laneId: NativeLaneId
  // The capability that activated this lane. Carried on the RESULT, not looked
  // up from the registry, so the persisted lane-summary artifact can name the
  // declaration a row answers for without importing ./lanes.mts.
  capability: LaneCapability
  measured: boolean
  skippedReason: string | undefined
  summary: LineCoverage | undefined
  detailPath: string | undefined
  exitCode: number
}

export interface CoverageLane {
  id: NativeLaneId
  capability: LaneCapability
  /**
   * The declared paths this lane covers for the given parsed
   * socket-wheelhouse.json, or `undefined` when the repo declares nothing for
   * the lane's capability. Undefined means "not this repo's concern"; an empty
   * array means the repo declared the capability and gave it nowhere to look,
   * which the registry treats as nothing to measure.
   */
  appliesTo(repoConfig: unknown): string[] | undefined
  run(ctx: LaneRunContext): Promise<LaneResult>
}

/**
 * The top-level `capabilities` map of a parsed socket-wheelhouse.json, reduced
 * to the capabilities that own a native lane.
 *
 * Tolerant by design — an absent, non-object, or array `capabilities` yields
 * `{}`, an unknown key is ignored, and a non-string glob entry is dropped. This
 * is the READ path, and the WRITE path already fails loud: sync-scaffolding's
 * config validator rejects a bad capability key or a non-string glob before it
 * can land. Duplicating that error here would report the same defect twice, at
 * a point where nothing can be fixed.
 *
 * A capability declared with an EMPTY array is kept as an empty array rather
 * than dropped, so a caller can tell "declared nothing" apart from "never
 * declared" — the coverage-lanes-are-wired check flags the former.
 */
export function readRepoCapabilities(
  repoConfig: unknown,
): Partial<Record<LaneCapability, string[]>> {
  const out: Partial<Record<LaneCapability, string[]>> = {}
  if (
    !repoConfig ||
    typeof repoConfig !== 'object' ||
    Array.isArray(repoConfig)
  ) {
    return out
  }
  const raw = (repoConfig as { capabilities?: unknown | undefined })
    .capabilities
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return out
  }
  const declared = raw as Record<string, unknown>
  // Iterate the KNOWN capabilities rather than the config's own keys: that is
  // what makes an unknown key a no-op here, and it fixes the output order to
  // LANE_CAPABILITIES regardless of how the JSON was written.
  for (let i = 0, { length } = LANE_CAPABILITIES; i < length; i += 1) {
    const capability = LANE_CAPABILITIES[i]!
    const rawGlobs = declared[capability]
    if (!Array.isArray(rawGlobs)) {
      continue
    }
    const globs: string[] = []
    for (let j = 0, { length: globCount } = rawGlobs; j < globCount; j += 1) {
      const glob: unknown = rawGlobs[j]
      if (typeof glob === 'string') {
        globs.push(glob)
      }
    }
    out[capability] = globs
  }
  return out
}

/**
 * Fold parsed lcov records into a line-coverage roll-up. `total` is the line
 * DENOMINATOR, and zero is the collected-nothing signal every lane gates on —
 * see outcome 3 in the file header.
 */
export function lineCoverageFromLcov(files: LcovFileCoverage[]): LineCoverage {
  let covered = 0
  let total = 0
  for (let i = 0, { length } = files; i < length; i += 1) {
    const file = files[i]!
    covered += file.linesHit
    total += file.linesTotal
  }
  return {
    covered,
    pct: total === 0 ? '0.00' : ((covered / total) * 100).toFixed(2),
    total,
  }
}

/**
 * The same fold, straight from lcov TEXT. All three native lanes read an lcov
 * file off disk, so the parse-then-fold pair lives here once instead of in each
 * lane. `repoRoot` anchors the relative paths lcov records.
 */
export function lineCoverageFromLcovText(
  lcovText: string,
  repoRoot: string,
): LineCoverage {
  return lineCoverageFromLcov(parseLcov(lcovText, repoRoot))
}

/**
 * The message for a lane that ran and measured nothing while its capability
 * declared paths. Generalized from `describeEmptyCollection` in ./bun-lane.mts
 * so every lane reports this failure identically. Four ingredients, in order:
 * What / Where / Saw vs. wanted / Fix.
 */
export function describeLaneMeasuredNothing(
  laneId: NativeLaneId,
  where: string,
  reason: 'missing' | 'empty' | 'no-lines',
): string {
  const saw = {
    empty: 'the coverage report exists but holds no file records',
    missing: 'no coverage report was written',
    'no-lines':
      'the coverage report holds file records but zero measurable lines',
  }[reason]
  return [
    `The ${laneId} coverage lane collected nothing.`,
    `  Where: ${where}`,
    `  Saw:   ${saw}; wanted at least one file with measurable lines.`,
    `  Fix:   this repo DECLARES the ${laneId} lane's capability, so measuring`,
    '         nothing is a real failure rather than an empty repo. Check that the',
    '         declared paths still hold source, that the tests actually load it,',
    '         and that the coverage tool ran — then re-run the lane.',
  ].join('\n')
}

/**
 * The `skippedReason` for a lane whose tool is not installed. An EXPLICIT skip:
 * the caller prints this line, so the lane reads as skipped rather than passing
 * with no measurement behind it.
 */
export function describeLaneToolAbsent(
  laneId: NativeLaneId,
  tool: string,
  installHint: string,
): string {
  return `${laneId} lane skipped: ${tool} not found — install via ${installHint}`
}
