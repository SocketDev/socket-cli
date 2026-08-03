#!/usr/bin/env node
/*
 * @file Fail-closed gate: a repo's vitest tuning lives in the ONE settings
 *   file, `.config/repo/socket-wheelhouse.json` `vitest` section, never a
 *   standalone `.config/repo/vitest.json`. The canonical vitest config
 *   (.config/repo/vitest.config.mts) reads ONLY the socket-wheelhouse.json
 *   `vitest` section, so a leftover `vitest.json` is dead config — its
 *   alias/pool/conditions/exclude keys silently do nothing, and the test suite
 *   runs with different resolution than the file claims. That is exactly the
 *   orphan a cascade strands when the reader is consolidated but a member's
 *   old per-file config is left on disk (the vscode stub alias, the webext
 *   browser-build alias, a pool/exclude override), so this gate makes the
 *   orphan fail loud instead of degrading tests silently.
 *
 *   config-segregation twin: the one-config-surface rule is the WHY; this
 *   check is the code-is-law enforcement for the specific vitest surface.
 *   Exit codes: 0 — no orphaned vitest.json; 1 — one is present.
 *   Usage: node scripts/fleet/check/vitest-config-is-consolidated.mts [--quiet]
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

const CHECK_NAME = 'vitest-config-is-consolidated'

/**
 * The orphaned per-repo config this gate forbids; its keys belong in the
 * `vitest` section of the settings file below.
 */
export const ORPHAN_VITEST_CONFIG = '.config/repo/vitest.json'

/**
 * The one settings file the canonical vitest config actually reads.
 */
export const SETTINGS_FILE = '.config/repo/socket-wheelhouse.json'

/**
 * The repo-relative path of an orphaned `vitest.json` under `repoRoot`, or
 * `undefined` when the config is consolidated. Pure filesystem so a unit test
 * drives both branches with a tmpdir fixture.
 */
export function findOrphanedVitestConfig(repoRoot: string): string | undefined {
  return existsSync(path.join(repoRoot, ORPHAN_VITEST_CONFIG))
    ? ORPHAN_VITEST_CONFIG
    : undefined
}

/**
 * The four-ingredient failure message (What / Where / Saw vs. wanted / Fix)
 * for an orphaned vitest.json under `repoRoot`.
 */
export function describeOrphanedVitestConfig(
  repoRoot: string,
  orphan: string,
): string {
  return [
    'The vitest config is not consolidated into the one settings file.',
    `  Where: ${normalizePath(path.join(repoRoot, orphan))}`,
    `  Saw:   a standalone ${orphan}; wanted its keys folded into the ` +
      `\`vitest\` section of ${SETTINGS_FILE}.`,
    `  Fix:   move the alias / pool / conditions / exclude keys into the ` +
      `\`vitest\` section of ${SETTINGS_FILE}, then delete ${orphan}. The`,
    '         canonical vitest config reads ONLY that section, so a leftover',
    '         vitest.json is dead config that silently changes nothing.',
  ].join('\n')
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const orphan = findOrphanedVitestConfig(REPO_ROOT)
  if (orphan) {
    logger.fail(
      `[${CHECK_NAME}] ${describeOrphanedVitestConfig(REPO_ROOT, orphan)}`,
    )
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      `[${CHECK_NAME}] vitest config is consolidated into ${SETTINGS_FILE}.`,
    )
  }
}

if (isMainModule(import.meta.url)) {
  main()
}
