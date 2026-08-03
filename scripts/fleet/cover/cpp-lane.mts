/*
 * @file The C/C++ coverage lane. A repo that declares a `cpp` capability in
 *   `.config/repo/socket-wheelhouse.json` gets its native coverage folded into
 *   `pnpm run cover`; the lane registry (./lanes.mts) wires capability → lane,
 *   this module only knows how to run the C/C++ half.
 *
 *   C++ has no universal build manifest, so this lane DELEGATES the build and
 *   the test run to a repo-owned `scripts/repo/cover-cpp.mts`: the fleet cannot
 *   know a member's compiler flags, its test binary, or where its build tree
 *   lands, and guessing produces a lane that silently measures the wrong
 *   artifact. The delegate's contract is one file: write lcov to the
 *   `--lcov-out` path it is handed. Everything after that — parse, fold, gate —
 *   is identical to the other lanes, which is what keeps the reported number
 *   comparable across languages.
 *
 *   A repo that declares `cpp` and ships no delegate is a WIRING defect, not a
 *   coverage number: `scripts/fleet/check/coverage-lanes-are-wired.mts` fails
 *   on it in pass 1, and this lane reports the same absence as an explicit skip
 *   rather than a 0.00% pass.
 *
 *   Same acceptance property as every lane (./lane-contract.mts): the delegate
 *   absent is an explicit skip, a run that measured nothing while the
 *   capability declared paths exits 1, and a failing build or test run
 *   propagates its real exit code. Every spawn goes through the INJECTED
 *   runner, so all three branches unit-test with no compiler on the machine.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  describeLaneMeasuredNothing,
  describeLaneToolAbsent,
  lineCoverageFromLcov,
  readRepoCapabilities,
} from './lane-contract.mts'
import { parseLcov } from './runner.mts'
import type { CoverageLane, LaneResult } from './lane-contract.mts'

type CppLaneRepoConfig = Parameters<CoverageLane['appliesTo']>[0]
type CppLaneContext = Parameters<CoverageLane['run']>[0]

/**
 * The repo-owned delegate this lane calls. Its PRESENCE is the cpp marker the
 * wiring check probes, since C/C++ has no manifest to look for.
 */
export const CPP_LANE_DELEGATE = 'scripts/repo/cover-cpp.mts'

const TOOL_ABSENT_FIX = `add ${CPP_LANE_DELEGATE} (build the declared paths with coverage instrumentation, run the tests, write lcov to the --lcov-out path)`

/**
 * Which repo-relative paths declare the `cpp` capability, or `undefined` when
 * the repo declares none. An empty array passes through — the registry, not
 * this helper, filters a declared-nothing capability out of the active set.
 */
export function appliesTo(repoConfig: CppLaneRepoConfig): string[] | undefined {
  return readRepoCapabilities(repoConfig).cpp ?? undefined
}

/**
 * Run the repo's delegate once, handing it every declared path plus the lcov
 * path to write. One spawn, not one per path: a C/C++ build is a single graph,
 * and re-running it per declared root would rebuild shared objects repeatedly.
 */
async function runDelegate(
  ctx: CppLaneContext,
  delegatePath: string,
  lcovOut: string,
): Promise<number> {
  const args = [delegatePath, '--lcov-out', lcovOut]
  for (let i = 0, { length } = ctx.paths; i < length; i += 1) {
    args.push('--path', ctx.paths[i]!)
  }
  try {
    const result = await ctx.runner(process.execPath, args, {
      cwd: ctx.repoRoot,
    })
    return result.exitCode
  } catch {
    // A delegate that cannot be spawned at all is a failed run, not a skip: the
    // file exists (checked above), so something about it is broken and that
    // must be loud.
    return 1
  }
}

/**
 * Run the C/C++ coverage lane end to end: confirm the repo ships its delegate,
 * run it, persist the lcov it wrote as the drill-down detail, fold it into a
 * line summary, and never let a zero-line result read as a pass.
 */
export async function run(ctx: CppLaneContext): Promise<LaneResult> {
  const delegatePath = path.join(ctx.repoRoot, CPP_LANE_DELEGATE)
  if (!existsSync(delegatePath)) {
    const message = describeLaneToolAbsent(
      'cpp',
      CPP_LANE_DELEGATE,
      TOOL_ABSENT_FIX,
    )
    // A delegate-absent skip is an explicit, expected stand-down (exit 0), not
    // a failure — warn, don't error.
    ctx.logger.warn(message)
    return {
      capability: 'cpp',
      detailPath: undefined,
      exitCode: 0,
      laneId: 'cpp',
      measured: false,
      skippedReason: message,
      summary: { covered: 0, pct: '0.00', total: 0 },
    }
  }

  mkdirSync(ctx.scratchDir, { recursive: true })
  const lcovOut = path.join(ctx.scratchDir, 'cpp.lcov')
  const runExitCode = await runDelegate(ctx, delegatePath, lcovOut)

  const sawLcov = existsSync(lcovOut)
  const combined = sawLcov ? readFileSync(lcovOut, 'utf8') : ''
  mkdirSync(ctx.detailDir, { recursive: true })
  const detailPath = path.join(ctx.detailDir, 'cpp.lcov')
  writeFileSync(detailPath, combined, 'utf8')

  const files = parseLcov(combined, ctx.repoRoot)
  const summary = lineCoverageFromLcov(files)
  const reason = !sawLcov
    ? 'missing'
    : files.length === 0
      ? 'empty'
      : summary.total === 0
        ? 'no-lines'
        : undefined
  if (reason) {
    ctx.logger.error(describeLaneMeasuredNothing('cpp', detailPath, reason))
    return {
      capability: 'cpp',
      detailPath,
      exitCode: runExitCode === 0 ? 1 : runExitCode,
      laneId: 'cpp',
      measured: true,
      skippedReason: undefined,
      summary,
    }
  }

  return {
    capability: 'cpp',
    detailPath,
    exitCode: runExitCode,
    laneId: 'cpp',
    measured: true,
    skippedReason: undefined,
    summary,
  }
}

export const cppLane: CoverageLane = {
  appliesTo,
  capability: 'cpp',
  id: 'cpp',
  run,
}
