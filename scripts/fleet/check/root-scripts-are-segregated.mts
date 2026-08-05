#!/usr/bin/env node
/*
 * @file Enforces the fleet script layout: root `scripts/` is a namespace only;
 *   executable scripts live under `scripts/fleet/`, cascaded tooling, or
 *   `scripts/repo/`, repo-owned tooling. Loose root scripts are ambiguous
 *   during cascades and let fleet/repo ownership drift silently.
 */

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'
import { collectTrackedFiles } from '../_shared/tracked-globs.mts'
import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

export async function findLooseRootScripts(
  repoRoot: string,
): Promise<string[]> {
  return await collectTrackedFiles(['scripts/*'], { cwd: repoRoot })
}

export async function main(): Promise<number> {
  const files = await findLooseRootScripts(REPO_ROOT)
  if (files.length === 0) {
    logger.success(
      '[root-scripts-are-segregated] root scripts are segregated into scripts/fleet/ or scripts/repo/.',
    )
    return 0
  }
  logger.fail(
    `[root-scripts-are-segregated] ${files.length} loose root script(s) found:`,
  )
  logger.group()
  for (const file of files) {
    logger.fail(file)
  }
  logger.groupEnd()
  logger.log(
    'Fix: move fleet-managed scripts to scripts/fleet/ and repo-owned scripts to scripts/repo/, then update every package, workflow, and documentation reference.',
  )
  logger.log(
    'Scope: only ROOT scripts/* move. A workspace member package resolves `node scripts/<name>.mts` against its OWN directory — those files do not move, so never blanket-rewrite `scripts/<name>.mts` strings tree-wide. Verify every rewritten reference still resolves (script-paths-resolve gates this, including member manifests).',
  )
  return 1
}

const SCRIPT_META: ScriptMeta = {
  describe: 'check that no executable script sits loose at the scripts/ root',
  help: 'Usage: node scripts/fleet/check/root-scripts-are-segregated.mts',
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
