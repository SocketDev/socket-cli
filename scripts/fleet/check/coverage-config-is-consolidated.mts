#!/usr/bin/env node
/*
 * @file Fail-closed gate: a repo's coverage include/exclude overlay lives in
 *   the ONE settings file, `.config/repo/socket-wheelhouse.json` `coverage`
 *   section, never a standalone `.config/repo/coverage.json`. The canonical
 *   coverage config (.config/fleet/vitest.coverage.fleet.config.mts) reads ONLY
 *   the socket-wheelhouse.json `coverage` section, so a leftover
 *   `coverage.json` is dead config — its include/exclude keys silently do
 *   nothing, and the suite measures a different denominator than the file
 *   claims (the exact false-green shape a 0% that exits 0 rides on). That is
 *   the orphan a cascade strands when the reader is consolidated but a member's
 *   old per-file overlay is left on disk, so this gate makes the orphan fail
 *   loud instead of degrading coverage silently.
 *
 *   config-segregation twin: the one-config-surface rule is the WHY; this
 *   check is the code-is-law enforcement for the specific coverage surface,
 *   mirroring vitest-config-is-consolidated.
 *   Exit codes: 0 — no orphaned coverage.json; 1 — one is present.
 *   Usage: node scripts/fleet/check/coverage-config-is-consolidated.mts [--quiet]
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

const CHECK_NAME = 'coverage-config-is-consolidated'

/**
 * The orphaned per-repo config this gate forbids; its keys belong in the
 * `coverage` section of the settings file below.
 */
export const ORPHAN_COVERAGE_CONFIG = '.config/repo/coverage.json'

/**
 * The one settings file the canonical coverage config actually reads.
 */
export const SETTINGS_FILE = '.config/repo/socket-wheelhouse.json'

/**
 * The repo-relative path of an orphaned `coverage.json` under `repoRoot`, or
 * `undefined` when the config is consolidated. Pure filesystem so a unit test
 * drives both branches with a tmpdir fixture.
 */
export function findOrphanedCoverageConfig(
  repoRoot: string,
): string | undefined {
  return existsSync(path.join(repoRoot, ORPHAN_COVERAGE_CONFIG))
    ? ORPHAN_COVERAGE_CONFIG
    : undefined
}

/**
 * The four-ingredient failure message (What / Where / Saw vs. wanted / Fix)
 * for an orphaned coverage.json under `repoRoot`.
 */
export function describeOrphanedCoverageConfig(
  repoRoot: string,
  orphan: string,
): string {
  return [
    'The coverage overlay is not consolidated into the one settings file.',
    `  Where: ${normalizePath(path.join(repoRoot, orphan))}`,
    `  Saw:   a standalone ${orphan}; wanted its keys folded into the ` +
      `\`coverage\` section of ${SETTINGS_FILE}.`,
    `  Fix:   move the include / exclude keys into the \`coverage\` section ` +
      `of ${SETTINGS_FILE}, then delete ${orphan}. The canonical coverage`,
    '         config reads ONLY that section, so a leftover coverage.json is',
    '         dead config that silently measures a different denominator.',
  ].join('\n')
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const orphan = findOrphanedCoverageConfig(REPO_ROOT)
  if (orphan) {
    logger.fail(
      `[${CHECK_NAME}] ${describeOrphanedCoverageConfig(REPO_ROOT, orphan)}`,
    )
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      `[${CHECK_NAME}] coverage overlay is consolidated into ${SETTINGS_FILE}.`,
    )
  }
}

if (isMainModule(import.meta.url)) {
  main()
}
