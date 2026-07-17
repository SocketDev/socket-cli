#!/usr/bin/env node
// Fleet-wide check: the two STATIC ignore surfaces cover every GENERATED_GLOBS
// entry, `**/`-anchored.
//
// GENERATED_GLOBS (scripts/fleet/constants/generated-globs.mts) is the single
// source of truth for generated/vendored trees. The importing consumers (oxlint
// ignorePatterns, vitest exclude, the test.mts staged-filter) spread it and can
// never drift. The format + git surfaces are static text formats that cannot
// import a module:
//
//   - format — .config/fleet/.prettierignore must carry each entry verbatim
//     (`**/<dir>/**`) or as its dir form (`**/<dir>/`).
//   - git    — the fleet-canonical .gitignore block (spliced by the cascade
//     from the wheelhouse's sync-scaffolding gitignore-fleet-block source)
//     must carry each entry's dir form.
//
// A bare, unanchored twin (`dist/`) does NOT count: the .prettierignore matcher
// roots at the ignore file's directory (see
// prettierignore-globs-are-anchored.mts), and the fleet convention is one
// canonical `**/`-anchored spelling per surface so the lists stay greppable
// against the module.
//
// Vacuous pass when .config/fleet/.prettierignore is absent (a non-fleet
// repo). When .gitignore has no fleet-canonical block (a pre-cascade repo),
// the whole file is scanned instead so coverage is still asserted.
//
// Exit: 0 = both surfaces cover every entry; 1 = at least one uncovered entry.
// Usage: node scripts/fleet/check/generated-globs-are-consistent.mts [--quiet]

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  isFleetMarkerBeginLine,
  isFleetMarkerEndLine,
} from '../../../.claude/hooks/fleet/_shared/fleet-markers.mts'
import { GENERATED_GLOBS } from '../constants/generated-globs.mts'
import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

const GITIGNORE_PATH = '.gitignore'
const PRETTIERIGNORE_PATH = path.join('.config', 'fleet', '.prettierignore')

export interface UncoveredGlob {
  readonly forms: readonly string[]
  readonly glob: string
}

/**
 * The accepted `**​/`-anchored spellings of one GENERATED_GLOBS entry:
 * the entry itself (`**​/dist/**`, the contents form) and its dir form
 * (`**​/dist/`, what the .gitignore block uses). Both ignore the whole
 * tree under gitignore-style matching.
 */
export function coveringForms(glob: string): string[] {
  if (glob.endsWith('/**')) {
    return [glob, glob.slice(0, -2)]
  }
  return [glob]
}

/**
 * The active (non-blank, non-comment) patterns of an ignore surface, trimmed.
 */
export function activePatterns(content: string): Set<string> {
  const patterns = new Set<string>()
  const lines = content.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const trimmed = lines[i]!.trim()
    if (trimmed !== '' && !trimmed.startsWith('#')) {
      patterns.add(trimmed)
    }
  }
  return patterns
}

/**
 * Every GENERATED_GLOBS entry the surface does not cover with one of its
 * `**​/`-anchored forms. Pure over the surface content so tests exercise it
 * with inline fixtures.
 */
export function findUncoveredGlobs(
  content: string,
  globs: readonly string[],
): UncoveredGlob[] {
  const present = activePatterns(content)
  const uncovered: UncoveredGlob[] = []
  for (let i = 0, { length } = globs; i < length; i += 1) {
    const glob = globs[i]!
    const forms = coveringForms(glob)
    if (!forms.some(f => present.has(f))) {
      uncovered.push({ forms, glob })
    }
  }
  return uncovered
}

/**
 * The region of a .gitignore this check asserts against: the fleet-canonical
 * block (exclusive of its markers) when present — that is the cascade-owned
 * source the entries must live in — else the whole file, so a pre-cascade
 * repo is still checked rather than false-greening.
 */
export function gitignoreScanRegion(content: string): string {
  const lines = content.split('\n')
  const beginIdx = lines.findIndex(l => isFleetMarkerBeginLine(l))
  const endIdx = lines.findIndex(l => isFleetMarkerEndLine(l))
  if (beginIdx !== -1 && endIdx > beginIdx) {
    return lines.slice(beginIdx + 1, endIdx).join('\n')
  }
  return content
}

function reportUncovered(
  surface: string,
  uncovered: UncoveredGlob[],
  fix: string,
): void {
  for (const u of uncovered) {
    logger.error(
      `  ${surface}: no covering pattern for ${u.glob}\n` +
        `    Saw: none of ${u.forms.join(' / ')} present; every GENERATED_GLOBS entry needs a **/-anchored twin on this static surface.\n` +
        `    Fix: ${fix}`,
    )
  }
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const prettierignoreAbs = path.join(REPO_ROOT, PRETTIERIGNORE_PATH)
  if (!existsSync(prettierignoreAbs)) {
    // No fleet .prettierignore (a non-fleet repo) — nothing to assert.
    return
  }
  const gitignoreAbs = path.join(REPO_ROOT, GITIGNORE_PATH)
  const gitignoreContent = existsSync(gitignoreAbs)
    ? readFileSync(gitignoreAbs, 'utf8')
    : ''
  const uncoveredFormat = findUncoveredGlobs(
    readFileSync(prettierignoreAbs, 'utf8'),
    GENERATED_GLOBS,
  )
  const uncoveredGit = findUncoveredGlobs(
    gitignoreScanRegion(gitignoreContent),
    GENERATED_GLOBS,
  )
  const total = uncoveredFormat.length + uncoveredGit.length
  if (total === 0) {
    if (!quiet) {
      logger.log(
        `${PRETTIERIGNORE_PATH} + ${GITIGNORE_PATH} cover every GENERATED_GLOBS entry.`,
      )
    }
    return
  }
  logger.error(
    `generated-globs-are-consistent: ${total} GENERATED_GLOBS ${total === 1 ? 'entry' : 'entries'} missing from a static ignore surface.`,
  )
  reportUncovered(
    PRETTIERIGNORE_PATH,
    uncoveredFormat,
    'add the entry to the canonical .config/fleet/.prettierignore (template/base/.config/fleet/.prettierignore in the wheelhouse) and cascade.',
  )
  reportUncovered(
    GITIGNORE_PATH,
    uncoveredGit,
    "add the dir form to FLEET_ENTRIES in the wheelhouse's scripts/repo/sync-scaffolding/checks/gitignore-fleet-block.mts and re-cascade (`pnpm run sync`).",
  )
  process.exitCode = 1
}

if (isMainModule(import.meta.url)) {
  main()
}
