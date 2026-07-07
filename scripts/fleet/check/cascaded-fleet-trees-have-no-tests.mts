#!/usr/bin/env node
/*
 * @file `check --all` gate: the cascaded co-located trees ship NO `*.test.*`
 *   files. The fleet hook tree (`.claude/hooks/fleet`), the oxlint plugin
 *   (`.config/fleet/oxlint-plugin`), and the git-hooks tree (`.git-hooks`)
 *   cascade byte-identical to every member AND into the GitHub release bundle.
 *   The cascaded `vitest.config.mts` EXCLUDES exactly those paths, so a member
 *   can never run a test that lives there — it only ships as dead weight that
 *   the wheelhouse alone validates.
 *
 *   So the wheelhouse's own hook / lint-rule / git-hook tests live under
 *   `test/repo/{unit,integration,e2e}/` (wheelhouse-only, run under vitest),
 *   NOT co-located in the cascaded trees. This gate fails loud if a `*.test.*`
 *   reappears under a cascaded tree — at which point it would silently ride out
 *   to members + the release again.
 *
 *   NOTE this is NOT the same concern as `test/unit/fleet/**`: those ARE
 *   deliberately cascaded in lock-step with the fleet scripts they cover and
 *   members DO run them (manifest/files.mts). This gate only governs the three
 *   trees whose tests members cannot run.
 *
 *   Usage: node scripts/fleet/check/cascaded-fleet-trees-have-no-tests.mts [--quiet]
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

// The cascaded co-located trees, scanned both at the template seed and live.
// A member's tests of fleet SCRIPTS live in test/unit/fleet/ (NOT here) — see
// the @file note.
const CASCADED_TREES: readonly string[] = [
  '.claude/hooks/fleet',
  '.config/fleet/oxlint-plugin',
  '.git-hooks',
]
const ROOTS: readonly string[] = ['template/base', '.']

// A `*.test.*` file (test.mts/ts/js/mjs/cjs/tsx/jsx). Path normalized to `/`.
const TEST_FILE_RE = /\.test\.[a-z]+$/

function walkForTests(dir: string, found: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    const full = path.join(dir, entry)
    let isDir = false
    try {
      isDir = statSync(full).isDirectory()
    } catch {
      continue
    }
    if (isDir) {
      walkForTests(full, found)
    } else if (TEST_FILE_RE.test(entry)) {
      found.push(full)
    }
  }
}

/**
 * Every `*.test.*` file living under a cascaded co-located tree, relative to
 * the repo root. Empty array = the gate passes.
 */
export function findCascadedTreeTests(repoRoot: string): string[] {
  const found: string[] = []
  for (let i = 0, { length } = ROOTS; i < length; i += 1) {
    const root = ROOTS[i]!
    for (let i = 0, { length } = CASCADED_TREES; i < length; i += 1) {
      const tree = CASCADED_TREES[i]!
      const abs = path.join(repoRoot, root, tree)
      if (existsSync(abs)) {
        walkForTests(abs, found)
      }
    }
  }
  return found
    .map(f => normalizePath(path.relative(repoRoot, f)))
    .toSorted((a, b) => a.localeCompare(b))
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const offenders = findCascadedTreeTests(REPO_ROOT)
  if (!offenders.length) {
    if (!quiet) {
      logger.log(
        'cascaded-fleet-trees-have-no-tests: OK (no co-located tests).',
      )
    }
    return
  }
  logger.error(
    [
      `cascaded-fleet-trees-have-no-tests: ${offenders.length} test file(s) ` +
        'co-located in a cascaded tree.',
      '',
      '  Where:',
      ...offenders.map(f => `    ${f}`),
      '',
      '  Saw:    a `*.test.*` under .claude/hooks/fleet, .config/fleet/oxlint-plugin,',
      '          or .git-hooks — which cascades to every member + the release',
      '          bundle but is excluded from the member vitest config, so it',
      '          ships as dead weight no member can run.',
      '  Wanted: wheelhouse-only tests under test/repo/{unit,integration,e2e}/',
      '          (run under vitest here, never cascaded).',
      '  Fix:    move the file to test/repo/<unit|integration>/<area>/<name>.test.mts,',
      '          rewriting its imports to reach the template/base source.',
      '',
    ].join('\n'),
  )
  process.exitCode = 2
}

main()
