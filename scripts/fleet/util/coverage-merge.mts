/**
 * @file Merge v8 `coverage-final.json` reports from the main and isolated test
 *   suites using a max-hit-count strategy, returning aggregate percentages.
 *   Extracted from `scripts/fleet/cover.mts` to keep that runner under the
 *   file-size cap — this is the pure data-crunching half (read two JSON
 *   reports, union their per-file counters taking the max hit count, derive
 *   statement / branch / function / line percentages). Takes `rootPath` + a
 *   logger so it stays free of module-scoped state.
 */

import fs from 'node:fs/promises'
import path from 'node:path'

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

function pct(covered: number, total: number): string {
  return total > 0 ? ((covered / total) * 100).toFixed(2) : '0.00'
}

// Merge coverage-final.json from the main and isolated suites using a
// max-hit-count strategy. Returns aggregate percentages, or undefined when
// neither report exists.
export async function mergeCoverageFinal(options: {
  rootPath: string
  logger: CoverageMergeLogger
}): Promise<AggregateCoverage | undefined> {
  const { logger, rootPath } = options
  const mainFinalPath = path.join(rootPath, 'coverage/coverage-final.json')
  const isolatedFinalPath = path.join(
    rootPath,
    'coverage-isolated/coverage-final.json',
  )

  let mainFinal: Record<string, CoverageFileFinal> = {}
  let isolatedFinal: Record<string, CoverageFileFinal> = {}
  try {
    mainFinal = JSON.parse(await fs.readFile(mainFinalPath, 'utf8')) as Record<
      string,
      CoverageFileFinal
    >
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
  } catch (e) {
    const err = e as NodeJS.ErrnoException | null
    if (err?.code !== 'ENOENT') {
      logger.warn(`Failed to read ${isolatedFinalPath}: ${err?.message}`)
    }
  }

  if (!Object.keys(mainFinal).length && !Object.keys(isolatedFinal).length) {
    return undefined
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
      const len = Math.max(mainArr.length, isoArr.length)
      mergedB[id] = Array.from({ length: len }, (value, j) =>
        Math.max(mainArr[j] ?? 0, isoArr[j] ?? 0),
      )
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
  }

  return {
    branches: pct(coveredBranches, totalBranches),
    functions: pct(coveredFunctions, totalFunctions),
    lines: pct(coveredLines, totalLines),
    statements: pct(coveredStatements, totalStatements),
  }
}
