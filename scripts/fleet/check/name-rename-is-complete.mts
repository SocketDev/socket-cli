#!/usr/bin/env node
/**
 * @file Commit-time gate: a recorded rename of a fleet NAME is FINISHED, not
 *   half-done. The fleet renames things (a check, script, hook, lint rule,
 *   skill) and the painful failure mode is a rename that lands across some
 *   surfaces but not all — the OLD name and the NEW name coexist, so a reader
 *   (or a cascade) can't tell which is canonical, and tooling that keys on the
 *   name silently splits. (Motivating churn: a make-/generate-/make- round-trip
 *   and a kind→repo.type schema migration that touched many files.)
 *   The convention this enforces: when you rename a fleet name, record it with
 *   a `renamed-from: <old-name>` marker (in the renamed file's `@file` comment,
 *   or a doc, or the manifest) — a single hyphenated/scoped token naming the
 *   PRIOR name. This gate then asserts the rename is COMPLETE: the `<old-name>`
 *   is fully gone — absent as a live fleet file (a `<old>.mts` script, a
 *   `<old>/index.mts` hook dir, a `<old>.mts` lint rule) AND absent from every
 *   reference in the fleet surfaces (so nothing still points at the prior
 *   name). It's the structural twin of the `plan-review-nudge` "settle the
 *   shape before the cascade" nudge: the reminder fires at plan time, this
 *   fails the gate if a rename lands half-finished.
 *   Deterministic — file existence + a reference scan, no git history. Pairs
 *   with script-paths-resolve / doc-references-resolve (which catch a reference
 *   to a MISSING file); this catches the inverse — a recorded-renamed-from name
 *   whose prior form is still alive (the rename didn't finish).
 *   Exit codes: 0 — every recorded rename is complete (or none recorded);
 *   1 — at least one `renamed-from: <old>` whose prior name still lives / is
 *   referenced.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

// `renamed-from: <old-name>` — a single fleet-name token (kebab-case, optional
// `socket/` scope for a lint rule). Tolerates `#`/`//`/`/*` comment prefixes
// and surrounding backticks. The captured token is the PRIOR name whose
// disappearance this gate verifies.
const RENAMED_FROM_RE =
  /renamed-from:\s*`?((?:socket\/)?[a-z][a-z0-9-]*(?:\.mts)?)`?/gi // socket-lint: allow uncommented-regex

// Fleet surfaces a renamed name lives in (as a file) or is referenced from:
// scripts/{fleet,repo}, the fleet hooks, the oxlint plugin, the fleet docs, and
// CLAUDE.md. Build output / node_modules are skipped by the walker.
const SCAN_DIRS = [
  'scripts/fleet',
  'scripts/repo',
  '.claude/hooks/fleet',
  '.config/fleet/oxlint-plugin',
  'docs/agents.md/fleet',
] as const

const SKIP_DIRS = new Set([
  '.git',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
])

export interface RenameRecord {
  // The file that carries the `renamed-from:` marker.
  readonly file: string
  // The prior name the marker claims was renamed away from.
  readonly oldName: string
}

export interface IncompleteRename extends RenameRecord {
  // Why it's incomplete: the prior name still exists as a file, or is referenced.
  readonly reason: string
}

function walkFiles(dir: string, exts: readonly string[], out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const name = entries[i]!
    if (SKIP_DIRS.has(name) || name.startsWith('.git')) {
      continue
    }
    const abs = path.join(dir, name)
    let isDir = false
    try {
      isDir = statSync(abs).isDirectory()
    } catch {
      continue
    }
    if (isDir) {
      walkFiles(abs, exts, out)
    } else if (exts.some(e => name.endsWith(e))) {
      out.push(abs)
    }
  }
}

// Every fleet file worth scanning for markers + references (source + docs).
export function collectScanFiles(repoRoot: string): string[] {
  const out: string[] = []
  for (const rel of SCAN_DIRS) {
    walkFiles(path.join(repoRoot, rel), ['.mts', '.md', '.json'], out)
  }
  const claudeMd = path.join(repoRoot, 'CLAUDE.md')
  if (existsSync(claudeMd)) {
    out.push(claudeMd)
  }
  return out
}

// Extract every { file, oldName } from the `renamed-from:` markers in `files`.
export function collectRenameRecords(
  files: readonly string[],
  repoRoot: string,
): RenameRecord[] {
  const records: RenameRecord[] = []
  for (const abs of files) {
    let text: string
    try {
      text = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    for (const m of text.matchAll(RENAMED_FROM_RE)) {
      records.push({ file: path.relative(repoRoot, abs), oldName: m[1]! })
    }
  }
  return records
}

// Strip the `socket/` scope + `.mts` tail to the bare name token.
function bareName(oldName: string): string {
  return oldName.replace(/^socket\//, '').replace(/\.mts$/, '')
}

// True when the prior name still EXISTS as a live fleet file: a
// scripts/**/<bare>.mts, a .claude/hooks/fleet/<bare>/ dir, or a
// .config/fleet/oxlint-plugin/rules/<bare>.mts (a `socket/<bare>` rule).
export function oldNameFileExists(repoRoot: string, oldName: string): boolean {
  const bare = bareName(oldName)
  if (existsSync(path.join(repoRoot, '.claude/hooks/fleet', bare))) {
    return true
  }
  if (
    existsSync(
      path.join(repoRoot, '.config/fleet/oxlint-plugin/rules', `${bare}.mts`),
    )
  ) {
    return true
  }
  for (const tier of ['fleet', 'repo']) {
    const found: string[] = []
    walkFiles(path.join(repoRoot, 'scripts', tier), ['.mts'], found)
    if (found.some(f => path.basename(f) === `${bare}.mts`)) {
      return true
    }
  }
  return false
}

// True when the prior name is still REFERENCED in any scan file, excluding the
// `renamed-from:` marker line itself (the marker mention is expected).
export function oldNameReferenced(
  files: readonly string[],
  oldName: string,
): boolean {
  const bare = bareName(oldName)
  const ref = new RegExp(`\\b${bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
  for (const abs of files) {
    let text: string
    try {
      text = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    for (const line of text.split('\n')) {
      if (/renamed-from:/i.test(line)) {
        continue
      }
      if (ref.test(line)) {
        return true
      }
    }
  }
  return false
}

export function findIncompleteRenames(
  records: readonly RenameRecord[],
  files: readonly string[],
  repoRoot: string,
): IncompleteRename[] {
  const out: IncompleteRename[] = []
  for (const rec of records) {
    if (oldNameFileExists(repoRoot, rec.oldName)) {
      out.push({
        ...rec,
        reason: `prior name "${rec.oldName}" still exists as a live file (script / hook dir / lint rule) — the rename is half-done`,
      })
    } else if (oldNameReferenced(files, rec.oldName)) {
      out.push({
        ...rec,
        reason: `prior name "${rec.oldName}" is still referenced in a fleet surface — finish removing the old references`,
      })
    }
  }
  return out
}

function main(): void {
  const files = collectScanFiles(REPO_ROOT)
  const records = collectRenameRecords(files, REPO_ROOT)
  if (records.length === 0) {
    process.exit(0)
  }
  const incomplete = findIncompleteRenames(records, files, REPO_ROOT)
  if (incomplete.length === 0) {
    return
  }
  logger.fail(
    `[check-name-rename-is-complete] ${incomplete.length} half-finished rename(s):`,
  )
  for (let i = 0, { length } = incomplete; i < length; i += 1) {
    const x = incomplete[i]!
    logger.error(`  ${x.file}: ${x.reason}`)
  }
  logger.error(
    'A `renamed-from: <old>` marker promises the rename is COMPLETE. Finish it: delete the old file + every reference to the prior name (a cascaded name is expensive to leave half-renamed).',
  )
  process.exitCode = 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
