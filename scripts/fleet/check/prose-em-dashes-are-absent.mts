#!/usr/bin/env node
/*
 * @file `check --all` gate: prose in tracked markdown carries NO em-dash. Not
 *   "no chains" — none at all. Every U+2014 in prose is a finding.
 *
 *   Why none. The dash-parenthetical shape reads as machine prose, and on an
 *   outbound GitHub surface (a PR body, an issue comment, a release note) even
 *   one is an agent tell. The earlier gate allowed a single dash and only
 *   failed a pair, which left every doc one edit away from a chain and left
 *   the tell itself legal. The owner's call: one is already too many.
 *
 *   This is the gate-time twin of the `em-dash` pattern in
 *   `.claude/hooks/fleet/anti-prose-guard/patterns.mts`. That hook catches a
 *   dash the moment an agent writes one; this catches a dash that reached the
 *   tree some other way, so the rule holds for a human edit and a cascaded
 *   file too.
 *
 *   ONE fix, and it is mechanical: replace the em-dash with a plain hyphen and
 *   leave the spacing alone, so ` — ` becomes ` - ` and `3—5` becomes `3-5`.
 *   `--fix` applies it, and it clears every finding the gate reports.
 *
 *   The detector, the caret renderer, and the fixer all live in
 *   `scripts/fleet/_shared/prose-em-dash.mts`. This file owns the walk, the
 *   burn-down bookkeeping, and the verdict.
 *
 *   Burn-down. The corpus was not clean when the rule tightened, so the files
 *   still carrying the backlog are listed by path in
 *   `scripts/fleet/constants/prose-em-dash-burn-down.json` with the date each
 *   entered. That list only ever shrinks, and it shrinks to empty. A file NOT
 *   listed gates normally, so nothing new can land while the backlog burns
 *   down. A listed file that scans clean is reported as a stale entry to drop.
 *
 *   Escape hatch: `<!-- prose-em-dash: allow -->` on the line, or
 *   `<!-- prose-em-dash: allow-file -->` anywhere in the file.
 *
 *   Scope: tracked `*.md`, minus fixtures dirs and generated CHANGELOGs, the
 *   same surface its aside sibling gates. Code fences, inline spans, and HTML
 *   comments are stripped before matching. An HTML comment carries a machine
 *   marker rather than prose, so a dash inside `<!-- enforcement: … -->` is
 *   not a finding, and neither is a `| — |` empty-value table cell. The code
 *   exemption is load-bearing: `.claude/hooks/fleet/_shared/verdict.mts`
 *   documents the verdict line the hooks actually emit, dash included, inside
 *   a code span, and rewriting it would change hook OUTPUT rather than prose.
 *
 *   Usage: node scripts/fleet/check/prose-em-dashes-are-absent.mts [--fix] [--quiet]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import {
  burnDownPaths,
  isBurnedDown,
} from '../constants/prose-em-dash-burn-down.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import {
  EM_DASH_ALLOW_LINE,
  EM_DASH_FIX,
  fixEmDashes,
  renderFinding,
  scanEmDashes,
} from '../_shared/prose-em-dash.mts'
import { runMain } from '../_shared/run-main.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'
import { collectMarkdownFiles } from './prose-parenthetical-asides-are-absent.mts'

const logger = getDefaultLogger()

export interface EmDashScanResult {
  // Report blocks, already rendered, for every gating finding.
  readonly report: string[]
  // Burn-down paths that scanned clean, so their entry is owed a removal.
  readonly stale: string[]
  // How many findings the burn-down list suppressed.
  readonly suppressed: number
}

/**
 * Scan `files` for em-dashes, splitting gating findings from the ones the
 * burn-down list still owes, and flagging burn-down entries that came back
 * clean.
 */
export function scanFilesForEmDashes(
  repoRoot: string,
  files: readonly string[],
): EmDashScanResult {
  const report: string[] = []
  const clean = new Set(burnDownPaths())
  let suppressed = 0
  for (let i = 0, { length } = files; i < length; i += 1) {
    const rel = files[i]!
    let content: string
    try {
      content = readFileSync(path.join(repoRoot, rel), 'utf8')
    } catch {
      continue
    }
    const findings = scanEmDashes(content)
    if (!findings.length) {
      continue
    }
    if (isBurnedDown(rel)) {
      clean.delete(rel)
      suppressed += findings.length
      continue
    }
    for (let j = 0, { length: flen } = findings; j < flen; j += 1) {
      report.push(...renderFinding(rel, findings[j]!))
    }
  }
  // A burn-down path the scan never reached (retired, renamed, or out of the
  // scoped subset) stays owed, so only files that were READ can go stale.
  const scanned = new Set(files)
  return {
    report,
    stale: [...clean].filter(rel => scanned.has(rel)).toSorted(),
    suppressed,
  }
}

/**
 * Every em-dash across the repo's tracked markdown. Empty report when clean.
 */
export function findEmDashes(repoRoot: string): EmDashScanResult {
  return scanFilesForEmDashes(repoRoot, collectMarkdownFiles(repoRoot))
}

function runFix(scope: readonly string[]): void {
  let files = 0
  let lines = 0
  for (let i = 0, { length } = scope; i < length; i += 1) {
    const abs = path.join(REPO_ROOT, scope[i]!)
    let content: string
    try {
      content = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    const result = fixEmDashes(content)
    if (result.changed) {
      writeFileSync(abs, result.content, 'utf8')
      files += 1
      lines += result.changed
    }
  }
  logger.info(
    `[prose-em-dashes-are-absent] --fix hyphenated ${lines} line(s) across ${files} file(s).`,
  )
}

function reportStale(stale: readonly string[]): void {
  if (!stale.length) {
    return
  }
  logger.warn(
    `[prose-em-dashes-are-absent] ${stale.length} burn-down entr(ies) now scan clean. Drop them from scripts/fleet/constants/prose-em-dash-burn-down.json:`,
  )
  for (let i = 0, { length } = stale; i < length; i += 1) {
    logger.warn(`  ${stale[i]!}`)
  }
}

function reportFindings(report: readonly string[]): void {
  logger.fail('[prose-em-dashes-are-absent] markdown prose carries em-dashes:')
  for (let i = 0, { length } = report; i < length; i += 1) {
    logger.error(report[i]!)
  }
  logger.error(`  One em-dash is one too many. For each: ${EM_DASH_FIX}.`)
  logger.error('  Run with --fix to apply every one of them.')
  logger.error(`  Keep one intentional dash with '${EM_DASH_ALLOW_LINE}'.`)
}

export function main(): number {
  // Non-flag args scope the scan to explicit paths; otherwise the whole tracked
  // markdown tree gates.
  const paths = process.argv.slice(2).filter(a => !a.startsWith('-'))
  const scope = paths.length
    ? paths.toSorted()
    : collectMarkdownFiles(REPO_ROOT)
  if (process.argv.includes('--fix')) {
    runFix(scope)
  }
  const result = scanFilesForEmDashes(REPO_ROOT, scope)
  reportStale(result.stale)
  if (result.report.length) {
    reportFindings(result.report)
    process.exitCode = 1
    return 1
  }
  if (!process.argv.includes('--quiet')) {
    const owed = burnDownPaths().length
    logger.success(
      owed
        ? `[prose-em-dashes-are-absent] markdown prose is em-dash free outside the burn-down list (${owed} file(s), ${result.suppressed} dash(es) still owed).`
        : '[prose-em-dashes-are-absent] markdown prose is em-dash free.',
    )
  }
  return 0
}

const SCRIPT_META: ScriptMeta = {
  describe: 'check that markdown prose carries no em-dash at all',
  help: `Usage: node scripts/fleet/check/prose-em-dashes-are-absent.mts [paths...] [flags]
  [paths...]   scope the scan to these files (default: the tracked markdown tree)
  --fix        swap every prose em-dash for a plain hyphen in place
  --quiet      suppress the success line`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
