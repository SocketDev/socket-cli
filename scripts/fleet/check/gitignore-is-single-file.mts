#!/usr/bin/env node
/**
 * @file Belt scan for the one-`.gitignore`-per-repo rule: a fleet repo keeps
 *   every ignore entry in a SINGLE root `.gitignore` (plus the
 *   `template/<archetype>/.gitignore` seed in the wheelhouse), never a nested
 *   per-directory `.gitignore`. Fails when any tracked `.gitignore` sits below
 *   a canonical root, naming each straggler + the fix. Reuses the
 *   `isNestedGitignore` predicate from the `no-nested-gitignore-guard` hook
 *   (imported directly — `runHook` is entrypoint-guarded, so importing the hook
 *   is a no-op) so the write-time guard and this belt scan can never diverge.
 *   Detail: docs/agents.md/fleet/single-gitignore.md.
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { isNestedGitignore } from '../../../.claude/hooks/fleet/no-nested-gitignore-guard/index.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

export function findNestedGitignores(files: readonly string[]): string[] {
  const nested: string[] = []
  for (let i = 0, { length } = files; i < length; i += 1) {
    const file = files[i]!
    if (isNestedGitignore(file)) {
      nested.push(file)
    }
  }
  return nested
}

export function trackedGitignoreFiles(rootDir: string): string[] {
  const result = spawnSync('git', ['ls-files', '*.gitignore', '.gitignore'], {
    cwd: rootDir,
    stdio: 'pipe',
    stdioString: true,
  })
  if (result.status !== 0) {
    return []
  }
  return String(result.stdout ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

function main(): void {
  const nested = findNestedGitignores(trackedGitignoreFiles(REPO_ROOT))
  if (nested.length === 0) {
    logger.success('Ignore rules live in a single root .gitignore')
    return
  }
  logger.fail(
    'Nested .gitignore file(s) — move their entries to the root .gitignore',
  )
  logger.log('')
  for (let i = 0, { length } = nested; i < length; i += 1) {
    logger.log(`  ${nested[i]!}`)
  }
  logger.log('')
  logger.log(
    '  Add each pattern to the ROOT .gitignore (use a **/-anchored line',
  )
  logger.log('  to reach depth), then delete the nested file.')
  logger.log('  Detail: docs/agents.md/fleet/single-gitignore.md')
  process.exitCode = 1
}

if (isMainModule(import.meta.url)) {
  main()
}
