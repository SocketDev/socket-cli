/**
 * @file Merge v8 per-tier `coverage-final.<tier>.json` reports (main, isolated,
 *   children) using a max-hit-count strategy: derive aggregate percentages and
 *   persist the folded `coverage-final.json` + `coverage-summary.json` at the
 *   coverage-home root. Extracted from `scripts/fleet/cover.mts` to keep that
 *   runner under the file-size cap. Takes `rootPath` + a logger so it stays
 *   free of module-scoped state (paths re-anchor on `rootPath`).
 */

import fs from 'node:fs/promises'
import path from 'node:path'

import {
  COVERAGE_FINAL_CHILDREN_PATH,
  COVERAGE_FINAL_ISOLATED_PATH,
  COVERAGE_FINAL_MAIN_PATH,
  COVERAGE_FINAL_PATH,
  COVERAGE_SUMMARY_PATH,
  REPO_ROOT,
} from '../paths.mts'

export interface CoverageLocation {
  start: { line: number; column: number }
  end: { line: number; column: number }
}

export interface CoverageFileFinal {
  s?: Record<string, number> | undefined
  b?: Record<string, number[]> | undefined
  f?: Record<string, number> | undefined
  statementMap?: Record<string, CoverageLocation> | undefined
}

export interface AggregateCoverage {
  branches: string
  functions: string
  lines: string
  statements: string
}

export interface CoverageMergeLogger {
  warn: (message: string) => void
}

// Thrown when an EXPECTED coverage tier produced no coverage-final.json — a
// suite that ran but dropped its report. Silently skipping it computes the
// aggregate over FEWER tiers and over-reports (a coverage false-green). Callers
// opt into this hard failure by passing `expectedTiers`; cover.mts treats it as
// a non-zero exit, distinct from the general merge warning.
export class MissingTierCoverageError extends Error {
  readonly missingTiers: readonly string[]
  constructor(missingTiers: readonly string[]) {
    super(
      `missing coverage for expected tier(s): ${missingTiers.join(', ')} — each ran but produced no coverage-final.json (a dropped tier over-reports the aggregate)`,
    )
    this.name = 'MissingTierCoverageError'
    this.missingTiers = missingTiers
  }
}

function pct(covered: number, total: number): string {
  return total > 0 ? ((covered / total) * 100).toFixed(2) : '0.00'
}

/**
 * Max-hit union of two per-file coverage entries. Sound only for the SAME
 * source bytes (identical statement maps) — the twin fold verifies byte
 * identity before calling this.
 */
export function mergeFileFinal(
  a: CoverageFileFinal | undefined,
  b: CoverageFileFinal | undefined,
): CoverageFileFinal {
  const merged: CoverageFileFinal = {
    b: {},
    f: {},
    s: {},
    statementMap: { ...a?.statementMap, ...b?.statementMap },
  }
  for (const id of new Set([
    ...Object.keys(a?.s ?? {}),
    ...Object.keys(b?.s ?? {}),
  ])) {
    merged.s![id] = Math.max(a?.s?.[id] ?? 0, b?.s?.[id] ?? 0)
  }
  for (const id of new Set([
    ...Object.keys(a?.f ?? {}),
    ...Object.keys(b?.f ?? {}),
  ])) {
    merged.f![id] = Math.max(a?.f?.[id] ?? 0, b?.f?.[id] ?? 0)
  }
  for (const id of new Set([
    ...Object.keys(a?.b ?? {}),
    ...Object.keys(b?.b ?? {}),
  ])) {
    const aArr = a?.b?.[id] ?? []
    const bArr = b?.b?.[id] ?? []
    const longer = aArr.length >= bArr.length ? aArr : bArr
    const counts: number[] = []
    for (let j = 0, { length } = longer; j < length; j += 1) {
      counts[j] = Math.max(aArr[j] ?? 0, bArr[j] ?? 0)
    }
    merged.b![id] = counts
  }
  return merged
}

/**
 * Fold byte-identical template/live twins so mirrored source counts ONCE.
 * The wheelhouse measures both `template/base/<x>` (canonical) and `<x>`
 * (its cascaded live mirror); tests import one tier, so the other tier's
 * twin reads uncovered and halves the honest percentage. Every report key
 * under `template/base/` whose live twin is byte-identical on disk folds
 * into the live key (max-hit). Diverged pairs (a preset, a repo-owned
 * hybrid) are genuinely different code and stay separate. No-ops in a
 * member repo (no `template/base/` keys). Returns the folded-pair count.
 */
export async function foldTemplateTwins(
  report: Record<string, CoverageFileFinal>,
): Promise<number> {
  const marker = `${path.sep}template${path.sep}base${path.sep}`
  let folded = 0
  const keys = Object.keys(report)
  for (let i = 0, { length } = keys; i < length; i += 1) {
    const key = keys[i]!
    const at = key.indexOf(marker)
    if (at === -1) {
      continue
    }
    const liveKey = key.slice(0, at) + path.sep + key.slice(at + marker.length)
    let identical = false
    try {
      const [templateBytes, liveBytes] = await Promise.all([
        fs.readFile(key, 'utf8'),
        fs.readFile(liveKey, 'utf8'),
      ])
      identical = templateBytes === liveBytes
    } catch {
      // Either side unreadable (template-only file, removed live twin) —
      // not a twin pair; leave the entry untouched.
    }
    if (!identical) {
      continue
    }
    report[liveKey] = mergeFileFinal(report[liveKey], report[key])
    delete report[key]
    folded += 1
  }
  return folded
}

// Merge coverage-final.json from the main and isolated suites using a
// max-hit-count strategy. Returns aggregate percentages, or undefined when
// neither report exists.
export async function mergeCoverageFinal(config: {
  rootPath: string
  logger: CoverageMergeLogger
  expectedTiers?: readonly string[] | undefined
}): Promise<AggregateCoverage | undefined> {
  const { expectedTiers, logger, rootPath } = {
    __proto__: null,
    ...config,
  } as typeof config
  // Flat per-tier report paths, re-anchored on the caller's rootPath: the
  // COVERAGE_* constants are absolute (anchored on this repo's root), so a test
  // passing a tmp root — or a caller measuring another repo — reads that root's
  // coverage cache, not this one's.
  const mainFinalPath = path.join(
    rootPath,
    path.relative(REPO_ROOT, COVERAGE_FINAL_MAIN_PATH),
  )
  const isolatedFinalPath = path.join(
    rootPath,
    path.relative(REPO_ROOT, COVERAGE_FINAL_ISOLATED_PATH),
  )
  const childrenFinalPath = path.join(
    rootPath,
    path.relative(REPO_ROOT, COVERAGE_FINAL_CHILDREN_PATH),
  )

  let mainFinal: Record<string, CoverageFileFinal> = {}
  let isolatedFinal: Record<string, CoverageFileFinal> = {}
  // Track whether each tier's report was readable — a dropped (missing) tier is
  // the coverage false-green the strict-tier gate below catches.
  let isolatedTierPresent = false
  let sharedTierPresent = false
  try {
    mainFinal = JSON.parse(await fs.readFile(mainFinalPath, 'utf8')) as Record<
      string,
      CoverageFileFinal
    >
    sharedTierPresent = true
  } catch (e) {
    const err = e as NodeJS.ErrnoException | null
    if (err?.code !== 'ENOENT') {
      logger.warn(`Failed to read ${mainFinalPath}: ${err?.message}`)
    }
  }
  try {
    isolatedFinal = JSON.parse(
      await fs.readFile(isolatedFinalPath, 'utf8'),
    ) as Record<string, CoverageFileFinal>
    isolatedTierPresent = true
  } catch (e) {
    const err = e as NodeJS.ErrnoException | null
    if (err?.code !== 'ENOENT') {
      logger.warn(`Failed to read ${isolatedFinalPath}: ${err?.message}`)
    }
  }

  // Strict-tier gate (#213): every tier a caller says SHOULD have run must have
  // produced its coverage-final.json. A missing expected tier throws rather
  // than silently narrowing the aggregate. Opt-in — an empty `expectedTiers`
  // (or omitting it) preserves the prior report-only behavior.
  if (expectedTiers?.length) {
    const present: Record<string, boolean> = {
      isolated: isolatedTierPresent,
      shared: sharedTierPresent,
    }
    const missing = expectedTiers.filter(tier => !present[tier])
    if (missing.length) {
      throw new MissingTierCoverageError(missing)
    }
  }

  if (!Object.keys(mainFinal).length && !Object.keys(isolatedFinal).length) {
    return undefined
  }

  // Fold byte-identical template/live twins in each tier before the union so
  // mirrored source counts once (wheelhouse-only; a member has no
  // template/base keys and this no-ops).
  await foldTemplateTwins(mainFinal)
  await foldTemplateTwins(isolatedFinal)

  // Children tier (subprocess coverage): script entrypoints exercised via
  // spawn run outside the in-process V8 session, so the vitest tiers read
  // them as zero. cover.mts converts the raw NODE_V8_COVERAGE output to the
  // children tier's coverage-final.json; entries here GAP-FILL only —
  // a file the vitest tiers already measured keeps its in-process entry
  // (the two reports segment statements differently, so a per-id max-merge
  // across them would misalign). Absent file → tier skipped silently (the
  // children capture is best-effort by design).
  try {
    const childrenFinal = JSON.parse(
      await fs.readFile(childrenFinalPath, 'utf8'),
    ) as Record<string, CoverageFileFinal>
    await foldTemplateTwins(childrenFinal)
    const childrenKeys = Object.keys(childrenFinal)
    for (let i = 0, { length } = childrenKeys; i < length; i += 1) {
      const key = childrenKeys[i]!
      if (!(key in mainFinal) && !(key in isolatedFinal)) {
        isolatedFinal[key] = childrenFinal[key]!
      }
    }
  } catch (e) {
    const err = e as NodeJS.ErrnoException | null
    if (err?.code !== 'ENOENT') {
      logger.warn(`Failed to read ${childrenFinalPath}: ${err?.message}`)
    }
  }

  const allFiles = [
    ...new Set([...Object.keys(mainFinal), ...Object.keys(isolatedFinal)]),
  ]
  let totalStatements = 0
  let coveredStatements = 0
  let totalBranches = 0
  let coveredBranches = 0
  let totalFunctions = 0
  let coveredFunctions = 0
  let totalLines = 0
  let coveredLines = 0
  // Assemble the merged per-file report as we tally so the runner can persist a
  // combined coverage-final.json alongside the summary. Each tier's non-counter
  // fields (fnMap/branchMap/path) survive via spread; the counters +
  // statementMap are overridden with the max-hit union.
  const mergedReport: Record<string, CoverageFileFinal> = {}

  for (let fi = 0, { length: flen } = allFiles; fi < flen; fi += 1) {
    const file = allFiles[fi]!
    const main = mainFinal[file]
    const iso = isolatedFinal[file]

    const stmtMap = { ...main?.statementMap, ...iso?.statementMap }
    const allStmtKeys = [
      ...new Set([...Object.keys(main?.s ?? {}), ...Object.keys(iso?.s ?? {})]),
    ]
    const mergedS: Record<string, number> = {}
    for (let i = 0, { length } = allStmtKeys; i < length; i += 1) {
      const id = allStmtKeys[i]!
      mergedS[id] = Math.max(main?.s?.[id] ?? 0, iso?.s?.[id] ?? 0)
    }
    totalStatements += allStmtKeys.length
    coveredStatements += Object.values(mergedS).filter(c => c > 0).length

    const allBranchKeys = [
      ...new Set([...Object.keys(main?.b ?? {}), ...Object.keys(iso?.b ?? {})]),
    ]
    const mergedB: Record<string, number[]> = {}
    for (let i = 0, { length } = allBranchKeys; i < length; i += 1) {
      const id = allBranchKeys[i]!
      const mainArr = main?.b?.[id] ?? []
      const isoArr = iso?.b?.[id] ?? []
      // Merge element-wise up to the longer array; iterate over it so the
      // cached-length `{ length }` form applies (the bound is its length).
      const longer = mainArr.length >= isoArr.length ? mainArr : isoArr
      const branchCounts: number[] = []
      for (let j = 0, { length: len } = longer; j < len; j += 1) {
        branchCounts[j] = Math.max(mainArr[j] ?? 0, isoArr[j] ?? 0)
      }
      mergedB[id] = branchCounts
    }
    for (let i = 0, { length } = allBranchKeys; i < length; i += 1) {
      const id = allBranchKeys[i]!
      const arr = mergedB[id] || []
      totalBranches += arr.length
      coveredBranches += arr.filter(c => c > 0).length
    }

    const allFnKeys = [
      ...new Set([...Object.keys(main?.f ?? {}), ...Object.keys(iso?.f ?? {})]),
    ]
    const mergedF: Record<string, number> = {}
    for (let i = 0, { length } = allFnKeys; i < length; i += 1) {
      const id = allFnKeys[i]!
      mergedF[id] = Math.max(main?.f?.[id] ?? 0, iso?.f?.[id] ?? 0)
    }
    totalFunctions += allFnKeys.length
    coveredFunctions += Object.values(mergedF).filter(c => c > 0).length

    const lineSet = new Set<number>()
    const coveredLineSet = new Set<number>()
    const stmtEntries = Object.entries(stmtMap)
    for (let i = 0, { length } = stmtEntries; i < length; i += 1) {
      const entry = stmtEntries[i]!
      const id = entry[0]
      const loc = entry[1]
      const line = loc.start.line
      lineSet.add(line)
      if ((mergedS[id] ?? 0) > 0) {
        coveredLineSet.add(line)
      }
    }
    totalLines += lineSet.size
    coveredLines += coveredLineSet.size

    mergedReport[file] = {
      ...(iso ?? {}),
      ...(main ?? {}),
      b: mergedB,
      f: mergedF,
      s: mergedS,
      statementMap: stmtMap,
    }
  }

  const aggregate: AggregateCoverage = {
    branches: pct(coveredBranches, totalBranches),
    functions: pct(coveredFunctions, totalFunctions),
    lines: pct(coveredLines, totalLines),
    statements: pct(coveredStatements, totalStatements),
  }

  // Persist the combined report + json-summary at the coverage-home root
  // (re-anchored on rootPath). The badge + release gate read the summary from
  // COVERAGE_SUMMARY_PATH; COVERAGE_FINAL_PATH is the folded istanbul report.
  const finalOutPath = path.join(
    rootPath,
    path.relative(REPO_ROOT, COVERAGE_FINAL_PATH),
  )
  const summaryOutPath = path.join(
    rootPath,
    path.relative(REPO_ROOT, COVERAGE_SUMMARY_PATH),
  )
  await fs.mkdir(path.dirname(finalOutPath), { recursive: true })
  await fs.writeFile(finalOutPath, JSON.stringify(mergedReport))
  await fs.writeFile(
    summaryOutPath,
    JSON.stringify({
      total: {
        branches: { pct: Number.parseFloat(aggregate.branches) },
        functions: { pct: Number.parseFloat(aggregate.functions) },
        lines: { pct: Number.parseFloat(aggregate.lines) },
        statements: { pct: Number.parseFloat(aggregate.statements) },
      },
    }),
  )

  return aggregate
}
