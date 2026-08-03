/*
 * @file The Go coverage lane. A repo that declares a `go` capability in
 *   `.config/repo/socket-wheelhouse.json` gets `go test -covermode=atomic
 *   -coverprofile=<out> ./...` folded into `pnpm run cover`; the lane registry
 *   (./lanes.mts) wires capability → lane, this module only knows how to run
 *   the Go half.
 *
 *   Go's coverprofile is a simple text format, so the parse is dep-0 — no
 *   external converter, no lcov round-trip:
 *
 *     mode: atomic
 *     <file>:<startLine>.<col>,<endLine>.<col> <numStatements> <hitCount>
 *
 *   Each row is one statement BLOCK. `numStatements` is the block's
 *   denominator contribution and a non-zero `hitCount` covers all of them,
 *   which is exactly how `go tool cover` computes its own percentage. That
 *   number lands in the same `LineCoverage` shape every other lane reports, so
 *   the fold in ./native-lanes.mts never has to know which language produced
 *   it.
 *
 *   Same acceptance property as every lane (./lane-contract.mts): the toolchain
 *   absent is an explicit skip, a run that measured nothing while the
 *   capability declared paths exits 1, and a failing `go test` propagates its
 *   real exit code. Every spawn goes through the INJECTED runner, so all three
 *   branches unit-test with no Go toolchain on the machine.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  describeLaneMeasuredNothing,
  describeLaneToolAbsent,
  readRepoCapabilities,
} from './lane-contract.mts'
import { expandLanePaths } from './lane-paths.mts'
import type {
  CoverageLane,
  LaneResult,
  LineCoverage,
} from './lane-contract.mts'

type GoLaneRepoConfig = Parameters<CoverageLane['appliesTo']>[0]
type GoLaneContext = Parameters<CoverageLane['run']>[0]

const TOOL_ABSENT_FIX =
  'pnpm run setup:go (installs the pinned Go toolchain); in CI the coverage-lanes-are-wired check enforces it runs'

/**
 * Which repo-relative paths declare the `go` capability, or `undefined` when
 * the repo declares none. An empty array passes through — the registry, not
 * this helper, filters a declared-nothing capability out of the active set.
 */
export function appliesTo(repoConfig: GoLaneRepoConfig): string[] | undefined {
  return readRepoCapabilities(repoConfig).go ?? undefined
}

/**
 * Fold a Go coverprofile into the shared line-coverage roll-up. A malformed
 * row is skipped rather than throwing: a torn profile must read as "measured
 * less", which the caller then catches as a zero denominator, instead of
 * crashing the whole cover run.
 */
export function coverageFromGoProfile(profileText: string): LineCoverage {
  let covered = 0
  let total = 0
  const lines = profileText.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!.trim()
    // The `mode:` header carries no counts, and a blank tail row is normal.
    if (line.length === 0 || line.startsWith('mode:')) {
      continue
    }
    const fields = line.split(' ')
    if (fields.length < 3) {
      continue
    }
    const statements = Number(fields[fields.length - 2])
    const hits = Number(fields[fields.length - 1])
    if (!Number.isFinite(statements) || !Number.isFinite(hits)) {
      continue
    }
    total += statements
    if (hits > 0) {
      covered += statements
    }
  }
  return {
    covered,
    pct: total === 0 ? '0.00' : ((covered / total) * 100).toFixed(2),
    total,
  }
}

/**
 * The tool-presence probe. `go version` touches no module, so it is safe before
 * committing to anything. A non-zero exit OR a spawn failure both read as
 * "toolchain absent" — an explicit skip, never a silent pass.
 */
async function probeGo(ctx: GoLaneContext): Promise<LaneResult | undefined> {
  let probe: { exitCode: number }
  try {
    probe = await ctx.runner('go', ['version'], { cwd: ctx.repoRoot })
  } catch {
    probe = { exitCode: 1 }
  }
  if (probe.exitCode === 0) {
    return undefined
  }
  const message = describeLaneToolAbsent('go', 'go', TOOL_ABSENT_FIX)
  // A tool-absent skip is an explicit, expected stand-down (exit 0), not a
  // failure — warn, don't error.
  ctx.logger.warn(message)
  return {
    capability: 'go',
    detailPath: undefined,
    exitCode: 0,
    laneId: 'go',
    measured: false,
    skippedReason: message,
    summary: { covered: 0, pct: '0.00', total: 0 },
  }
}

/**
 * Run `go test` once per declared path, each writing its own coverprofile into
 * the run's scratch dir. The FIRST non-zero exit wins, so a failing module
 * cannot be masked by a later clean one.
 */
async function runPerPath(ctx: GoLaneContext): Promise<{
  exitCode: number
  profileChunks: string[]
  sawAnyProfile: boolean
}> {
  mkdirSync(ctx.scratchDir, { recursive: true })
  // Declared paths may carry glob magic (`services/*`), which the wiring check
  // blesses; expand to concrete directories before a spawn uses one as its
  // cwd, or a literal glob cwd throws ENOENT and takes the whole run down.
  const entries = expandLanePaths(ctx.repoRoot, ctx.paths)
  let exitCode = 0
  let sawAnyProfile = false
  const profileChunks: string[] = []
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const cwd = path.join(ctx.repoRoot, entries[i]!)
    const outPath = path.join(ctx.scratchDir, `go-${i}.out`)
    const result = await ctx.runner(
      'go',
      [
        'test',
        '-covermode=atomic',
        `-coverprofile=${outPath}`,
        '-coverpkg=./...',
        './...',
      ],
      { cwd },
    )
    if (result.exitCode !== 0 && exitCode === 0) {
      exitCode = result.exitCode
    }
    if (existsSync(outPath)) {
      sawAnyProfile = true
      profileChunks.push(readFileSync(outPath, 'utf8'))
    }
  }
  return { exitCode, profileChunks, sawAnyProfile }
}

/**
 * Run the Go coverage lane end to end: probe, spawn one `go test` per declared
 * path, persist the concatenated coverprofile as the drill-down detail, fold it
 * into a line summary, and never let a zero-statement result read as a pass.
 */
export async function run(ctx: GoLaneContext): Promise<LaneResult> {
  const skip = await probeGo(ctx)
  if (skip) {
    return skip
  }

  const {
    exitCode: runExitCode,
    profileChunks,
    sawAnyProfile,
  } = await runPerPath(ctx)

  mkdirSync(ctx.detailDir, { recursive: true })
  const detailPath = path.join(ctx.detailDir, 'go.out')
  const combined = profileChunks.join('\n')
  writeFileSync(detailPath, combined, 'utf8')

  const summary = coverageFromGoProfile(combined)
  const reason = !sawAnyProfile
    ? 'missing'
    : summary.total === 0
      ? 'no-lines'
      : undefined
  if (reason) {
    ctx.logger.error(describeLaneMeasuredNothing('go', detailPath, reason))
    return {
      capability: 'go',
      detailPath,
      exitCode: runExitCode === 0 ? 1 : runExitCode,
      laneId: 'go',
      measured: true,
      skippedReason: undefined,
      summary,
    }
  }

  return {
    capability: 'go',
    detailPath,
    exitCode: runExitCode,
    laneId: 'go',
    measured: true,
    skippedReason: undefined,
    summary,
  }
}

export const goLane: CoverageLane = {
  appliesTo,
  capability: 'go',
  id: 'go',
  run,
}
