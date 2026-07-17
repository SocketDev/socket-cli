#!/usr/bin/env node
/*
 * @file Fleet-wide check: `.github/actions/` is segmented into `fleet/`
 *   (cascade-owned, delete-and-replace mirrored) and `repo/` (host-owned) —
 *   the same fleet/repo split as `.claude/hooks/` and
 *   `.config/fleet/oxlint-plugin/`. A flat `.github/actions/<name>` entry is a
 *   segmentation violation: the cascade's tombstones prune the historical flat
 *   locations, so a new flat action would sit outside both ownership tiers
 *   (never cascaded, yet not declared repo-owned) and a stray file there is
 *   never a valid composite action. CLAUDE.md "hook-registry" (one segmentation
 *   scheme across surfaces).
 *
 *   Exit codes:
 *   - 0 — `.github/actions/` absent, or every visible entry is fleet/ or repo/
 *   - 1 — at least one unsegmented entry found
 *
 *   Usage: node scripts/fleet/check/actions-are-segmented.mts [--quiet]
 */

import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

const SEGMENT_DIRS = new Set(['fleet', 'repo'])

/**
 * Return the unsegmented entries under an `.github/actions/` directory: every
 * visible entry that is not the `fleet/` or `repo/` segment dir. Dotfiles
 * (.gitkeep, .DS_Store) are skipped — segmentation governs actions, not
 * markers. A missing directory returns [] (repos without local actions pass).
 */
export function findUnsegmentedEntries(actionsDir: string): string[] {
  if (!existsSync(actionsDir)) {
    return []
  }
  const violations: string[] = []
  const entries = readdirSync(actionsDir, { withFileTypes: true })
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    if (entry.name.startsWith('.')) {
      continue
    }
    if (entry.isDirectory() && SEGMENT_DIRS.has(entry.name)) {
      continue
    }
    violations.push(entry.name)
  }
  return violations.toSorted()
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const actionsDir = path.join(REPO_ROOT, '.github', 'actions')
  const violations = findUnsegmentedEntries(actionsDir)
  if (violations.length === 0) {
    if (!quiet) {
      logger.success('.github/actions/ is segmented into fleet/ + repo/.')
    }
    return
  }
  logger.fail(
    `.github/actions/ has ${violations.length} unsegmented entr${violations.length === 1 ? 'y' : 'ies'}: ${violations.join(', ')}.`,
  )
  logger.error(
    '  Every local action lives under .github/actions/fleet/ (cascade-owned) ' +
      'or .github/actions/repo/ (host-owned) — a flat entry sits outside both ' +
      'ownership tiers.',
  )
  logger.error(
    '  Fix: move a repo-owned action to .github/actions/repo/<name>/ (and ' +
      'repoint its uses: refs); a fleet action is authored in ' +
      'socket-wheelhouse template/base/.github/actions/fleet/ and cascaded.',
  )
  process.exitCode = 1
}

if (isMainModule(import.meta.url)) {
  main()
}
