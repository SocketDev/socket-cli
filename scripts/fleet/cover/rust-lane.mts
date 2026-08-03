/*
 * @file The Rust coverage lane — one of the capability-gated native lanes the
 *   multi-language coverage design adds alongside the TS/JS v8 path. A repo
 *   that declares a `cargo` capability in `.config/repo/socket-wheelhouse.json`
 *   gets `cargo llvm-cov` folded into `pnpm run cover` automatically; the lane
 *   registry (./lanes.mts) is what wires capability → lane, this module only
 *   knows how to RUN the Rust half.
 *
 *   The SEAM is modeled on ./bun-lane.mts: every spawn goes through an
 *   INJECTED runner, so every branch here — tool-absent, a failing test exit,
 *   a missing/empty/zero-line lcov — unit-tests without cargo installed. What
 *   this lane does NOT do, unlike bun-lane, is own thresholds or the badge
 *   summary; it returns a `LaneResult` and the caller (scripts/fleet/cover.mts)
 *   folds it into the combined report. One lane, one job: run the tool, parse
 *   the output, report what it measured.
 *
 *   The pinned nightly (so `#[cfg_attr(coverage_nightly, coverage(off))]`
 *   markers are honored, per docs/agents.md/fleet/lint-parity-across-languages.md)
 *   comes from the target repo's OWN `rust-toolchain.toml` — this lane never
 *   passes a `+toolchain` arg; `cargo llvm-cov` resolves the repo pin itself.
 *
 *   Acceptance property, same shape as every other lane: a coverage gate must
 *   never report success while measuring nothing.
 *
 *   1. The tool absent is an explicit SKIP (`measured: false`), never a pass
 *      dressed as a real run.
 *   2. A capability that declared paths but produced no lcov — missing, empty,
 *      or a zero line denominator — is `measured: true` with `exitCode: 1`,
 *      even when cargo itself exited 0.
 *   3. A failing Rust test suite propagates its real exit code, the same way a
 *      failing vitest suite does.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  describeLaneMeasuredNothing,
  describeLaneToolAbsent,
  lineCoverageFromLcov,
  readRepoCapabilities,
} from './lane-contract.mts'
import { expandLanePaths } from './lane-paths.mts'
import { parseLcov } from './runner.mts'
import type { CoverageLane, LaneResult } from './lane-contract.mts'

// Derived structurally from the pinned contract rather than re-declared here,
// so this lane can never drift from the shape ./lane-contract.mts defines.
type RustLaneRepoConfig = Parameters<CoverageLane['appliesTo']>[0]
type RustLaneContext = Parameters<CoverageLane['run']>[0]
type RustLaneSummary = LaneResult['summary']

const TOOL_ABSENT_FIX =
  'pnpm run setup:rust (installs the pinned nightly + cargo-llvm-cov); in CI the coverage-lanes-are-wired check enforces it runs'

/**
 * Which repo-relative paths declare the `cargo` capability, or `undefined` when
 * the repo declares none at all. An empty array is left to pass through — the
 * lane REGISTRY (./lanes.mts) is what filters an empty-paths lane out of
 * `resolveActiveLanes`, not this helper.
 */
export function appliesTo(
  repoConfig: RustLaneRepoConfig,
): string[] | undefined {
  return readRepoCapabilities(repoConfig).cargo ?? undefined
}

/**
 * The tool-presence probe. `cargo llvm-cov --version` never touches a
 * workspace, so it is safe to run before committing to anything else. A
 * non-zero exit OR a spawn failure (the binary/subcommand is simply not
 * installed) both read as "tool absent" — an explicit, loud skip rather than a
 * silent pass.
 */
async function probeCargoLlvmCov(
  ctx: RustLaneContext,
): Promise<LaneResult | undefined> {
  let probe: { exitCode: number }
  try {
    probe = await ctx.runner('cargo', ['llvm-cov', '--version'], {
      cwd: ctx.repoRoot,
    })
  } catch {
    probe = { exitCode: 1 }
  }
  if (probe.exitCode === 0) {
    return undefined
  }
  const message = describeLaneToolAbsent(
    'rust',
    'cargo-llvm-cov',
    TOOL_ABSENT_FIX,
  )
  // A tool-absent skip is an explicit, expected stand-down (exit 0), not a
  // failure — warn, don't error.
  ctx.logger.warn(message)
  const summary: RustLaneSummary = { covered: 0, pct: '0.00', total: 0 }
  return {
    capability: 'cargo',
    detailPath: undefined,
    exitCode: 0,
    laneId: 'rust',
    measured: false,
    skippedReason: message,
    summary,
  }
}

/**
 * Run `cargo llvm-cov` once per declared `cargo` path, each writing its own
 * lcov file into the run's scratch dir. Returns the fold of every path's exit
 * code (first non-zero wins — a failing suite in path 2 must not be masked by
 * a clean exit from path 1) plus which per-path lcov files actually landed on
 * disk.
 */
async function runPerPath(
  ctx: RustLaneContext,
): Promise<{ exitCode: number; lcovChunks: string[]; sawAnyLcov: boolean }> {
  mkdirSync(ctx.scratchDir, { recursive: true })
  // Declared paths may carry glob magic (a `packages/*` style glob), which the
  // wiring check blesses; expand to concrete directories before a spawn uses
  // one as its cwd, or a literal glob cwd throws ENOENT and takes the run down.
  const entries = expandLanePaths(ctx.repoRoot, ctx.paths)
  let exitCode = 0
  let sawAnyLcov = false
  const lcovChunks: string[] = []
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    const cwd = path.join(ctx.repoRoot, entry)
    const outPath = path.join(ctx.scratchDir, `rust-${i}.lcov`)
    const result = await ctx.runner(
      'cargo',
      ['llvm-cov', '--workspace', '--lcov', '--output-path', outPath],
      { cwd },
    )
    if (result.exitCode !== 0 && exitCode === 0) {
      exitCode = result.exitCode
    }
    if (existsSync(outPath)) {
      sawAnyLcov = true
      lcovChunks.push(readFileSync(outPath, 'utf8'))
    }
  }
  return { exitCode, lcovChunks, sawAnyLcov }
}

/**
 * Run the Rust coverage lane end to end: probe, spawn one `cargo llvm-cov` per
 * declared path, concatenate the per-path lcov into one persisted detail file,
 * parse + summarize it, and never let a zero-line result read as a pass.
 */
export async function run(ctx: RustLaneContext): Promise<LaneResult> {
  const skip = await probeCargoLlvmCov(ctx)
  if (skip) {
    return skip
  }

  const {
    exitCode: runExitCode,
    lcovChunks,
    sawAnyLcov,
  } = await runPerPath(ctx)

  mkdirSync(ctx.detailDir, { recursive: true })
  const detailPath = path.join(ctx.detailDir, 'rust.lcov')
  const combined = lcovChunks.join('\n')
  writeFileSync(detailPath, combined, 'utf8')

  const files = parseLcov(combined, ctx.repoRoot)
  const summary = lineCoverageFromLcov(files)

  const reason = !sawAnyLcov
    ? 'missing'
    : files.length === 0
      ? 'empty'
      : summary.total === 0
        ? 'no-lines'
        : undefined
  if (reason) {
    ctx.logger.error(describeLaneMeasuredNothing('rust', detailPath, reason))
    return {
      capability: 'cargo',
      detailPath,
      exitCode: runExitCode === 0 ? 1 : runExitCode,
      laneId: 'rust',
      measured: true,
      skippedReason: undefined,
      summary,
    }
  }

  return {
    capability: 'cargo',
    detailPath,
    exitCode: runExitCode,
    laneId: 'rust',
    measured: true,
    skippedReason: undefined,
    summary,
  }
}

export const rustLane: CoverageLane = {
  appliesTo,
  capability: 'cargo',
  id: 'rust',
  run,
}
