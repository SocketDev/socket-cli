#!/usr/bin/env node
/*
 * @file Enforces the fleet script layout: root `scripts/` is a namespace only;
 *   executable scripts live under `scripts/fleet/` (cascaded tooling) or
 *   `scripts/repo/` (repo-owned tooling). Loose root scripts are ambiguous
 *   during cascades and let fleet/repo ownership drift silently.
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../_shared/is-main-module.mts'
import { collectTrackedFiles } from '../_shared/tracked-globs.mts'

const logger = getDefaultLogger()

export async function findLooseRootScripts(
  repoRoot: string,
): Promise<string[]> {
  return await collectTrackedFiles(['scripts/*'], { cwd: repoRoot })
}

async function main(): Promise<number> {
  const files = await findLooseRootScripts(process.cwd())
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
  return 1
}

if (isMainModule(import.meta.url)) {
  void main().then(code => {
    process.exitCode = code
  })
}
