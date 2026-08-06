#!/usr/bin/env node
/*
 * @file On-demand housekeeping for the reports tree at `.claude/reports`.
 *   NOT a `check --all` gate: that directory is gitignored (untracked,
 *   operator-local working notes), so a CI-time check would scan an empty
 *   or absent directory on every run and pass forever — a gate that can
 *   never fail is worse than no gate. This runs only when the operator asks
 *   for it.
 *
 *   Reports two things, both left for the operator to act on:
 *
 *   1. SLUG COLLISIONS — stripping a `YYYY-MM-DD-`/`YYYY-MM-DD-HHMM-` prefix
 *      and a trailing `-<digits>` suffix from the basename yields the
 *      report's slug; two files sharing a slug are the same report split
 *      across saves (e.g. `pending-parallel-triage.md` +
 *      `pending-parallel-triage-2.md` + `pending-parallel-triage-3.md`).
 *   2. UNDATED NAMES — a report whose basename lacks the `YYYY-MM-DD-`
 *      prefix gives no signal of whether it's current or a year stale.
 *
 *   Since these files are gitignored, filesystem mtime is the only
 *   available date signal — and it is NOT an authored date: a `git clone`,
 *   an editor resave, or a cascade touch all rewrite mtime without the
 *   report's content changing. It is used here only to ORDER a collision
 *   group (newest-first, so the operator merges into the most-recently-
 *   touched file), never presented as "when this was written."
 *
 *   This tool only REPORTS. It never deletes, merges, or renames a file —
 *   the operator reads the collision groups and merges by hand.
 *
 *   Scope: every `.md` file anywhere under the reports tree at
 *   `.claude/reports`, skipping the `cascade-reaped` subtree (reaped
 *   cascade state, not an authored report).
 *
 *   Usage: node scripts/fleet/consolidate-reports.mts [--quiet]
 */

import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { REPO_ROOT } from './paths.mts'
import { isMainModule } from './_shared/is-main-module.mts'
import { runMain } from './_shared/run-main.mts'

import type { ScriptMeta } from './_shared/run-main.mts'

const logger = getDefaultLogger()

const CLAUDE_DIR = '.claude'
const REPORTS_DIR = 'reports'
const CASCADE_REAPED_SEGMENT = 'cascade-reaped'

export interface ReportFile {
  readonly absPath: string
  readonly relPath: string
  readonly basename: string
  readonly mtimeMs: number
}

// A leading `YYYY-MM-DD-` or `YYYY-MM-DD-HHMM-` prefix on the report stem.
const DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2}-(?:\d{4}-)?/
// A trailing `-<digits>` suffix (a `-2`/`-3` save-collision counter).
const NUMERIC_SUFFIX_RE = /-\d+$/

/**
 * True when a report's basename carries the required `YYYY-MM-DD-` (or
 * `YYYY-MM-DD-HHMM-`) date prefix. Pure — string only, no filesystem access.
 */
export function isDatedReportName(basename: string): boolean {
  const stem = basename.replace(/\.md$/i, '')
  return DATE_PREFIX_RE.test(stem)
}

/**
 * The report's collision-detection slug: the basename with any leading date
 * prefix and any trailing numeric save-counter suffix stripped, so
 * `2026-07-26-owner-todo.md`, `owner-todo-2.md`, and `owner-todo.md` all
 * normalize to `owner-todo`. Pure.
 */
export function normalizeReportSlug(basename: string): string {
  const stem = basename.replace(/\.md$/i, '')
  const withoutDate = stem.replace(DATE_PREFIX_RE, '')
  return withoutDate.replace(NUMERIC_SUFFIX_RE, '')
}

/**
 * Recursively collect every `.md` file under `reportsRoot`, skipping any
 * path segment named `cascade-reaped`. Filesystem walk — not pure. Returns
 * an empty list when `reportsRoot` does not exist (the gitignored tree is
 * absent on a fresh clone / in CI).
 */
export function collectReportFiles(reportsRoot: string): ReportFile[] {
  const files: ReportFile[] = []

  function walk(dir: string): void {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (let i = 0, { length } = entries; i < length; i += 1) {
      const name = entries[i]!
      if (name === CASCADE_REAPED_SEGMENT) {
        continue
      }
      const full = path.join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        walk(full)
        continue
      }
      if (!st.isFile() || !/\.md$/i.test(name)) {
        continue
      }
      files.push({
        absPath: full,
        relPath: normalizePath(path.relative(REPO_ROOT, full)),
        basename: name,
        // mtime — the only date signal available for a gitignored file; an
        // ordering hint for collision groups, not an authored-date claim.
        mtimeMs: st.mtimeMs,
      })
    }
  }

  walk(reportsRoot)
  return files
}

/**
 * Every report whose basename lacks the `YYYY-MM-DD-` date prefix, sorted by
 * relative path. Pure over the given file list.
 */
export function findUndatedReports(files: readonly ReportFile[]): ReportFile[] {
  return files
    .filter(f => !isDatedReportName(f.basename))
    .toSorted((a, b) => a.relPath.localeCompare(b.relPath))
}

/**
 * Group reports by normalized slug, keeping only groups with 2+ members —
 * the collisions. Each group is sorted newest-first by mtime so the operator
 * merges into the newest and deletes the rest. Groups themselves are sorted
 * by slug for deterministic output. Pure over the given file list.
 */
export function findSlugCollisions(
  files: readonly ReportFile[],
): Array<{ slug: string; files: ReportFile[] }> {
  const bySlug = new Map<string, ReportFile[]>()
  for (let i = 0, { length } = files; i < length; i += 1) {
    const file = files[i]!
    const slug = normalizeReportSlug(file.basename)
    const group = bySlug.get(slug)
    if (group) {
      group.push(file)
    } else {
      bySlug.set(slug, [file])
    }
  }
  const collisions: Array<{ slug: string; files: ReportFile[] }> = []
  for (const [slug, group] of bySlug) {
    if (group.length > 1) {
      collisions.push({
        slug,
        files: group.toSorted((a, b) => b.mtimeMs - a.mtimeMs),
      })
    }
  }
  return collisions.toSorted((a, b) => a.slug.localeCompare(b.slug))
}

export function main(): number {
  const quiet = process.argv.includes('--quiet')
  const reportsRoot = path.join(REPO_ROOT, CLAUDE_DIR, REPORTS_DIR)
  const files = collectReportFiles(reportsRoot)
  const collisions = findSlugCollisions(files)
  const undated = findUndatedReports(files)

  if (collisions.length > 0) {
    logger.fail(
      `[consolidate-reports] ${collisions.length} report slug collision(s) — same report split across saves:`,
    )
    for (const { slug, files: group } of collisions) {
      logger.log('')
      logger.log(`  What: ${group.length} files normalize to slug "${slug}"`)
      logger.log(`  Where: the reports tree`)
      logger.log(
        `  Saw: ${group.map(f => f.relPath).join(', ')} (newest mtime first)`,
      )
      logger.log(
        `  Fix: merge into ${group[0]!.relPath} (newest), then delete the rest.`,
      )
    }
    logger.log('')
  }

  if (undated.length > 0) {
    logger.fail(
      `[consolidate-reports] ${undated.length} undated report(s) — no YYYY-MM-DD- prefix:`,
    )
    logger.log('')
    for (const f of undated) {
      logger.substep(f.relPath)
    }
    logger.log('')
    logger.log(
      '  Fix: rename each to YYYY-MM-DD-<slug>.md so staleness is visible at a glance.',
    )
    logger.log('')
  }

  if (collisions.length === 0 && undated.length === 0) {
    if (!quiet) {
      logger.success(
        '[consolidate-reports] no slug collisions, every report is dated.',
      )
    }
    return 0
  }

  process.exitCode = 1
  return 1
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'reports slug collisions and undated names in the .claude/reports tree',
  help: `Usage: node scripts/fleet/consolidate-reports.mts [flags]

  --quiet  suppress the clean-pass message`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
