#!/usr/bin/env node
/**
 * @file Belt scan for the golden-fixture naming rule: a committed test
 *   reference-output fixture must be `*.golden.json`, never `*.expected.json`
 *   (`expected` collides with the `expect(actual, expected)` assertion
 *   argument; `golden` is the authority-verified-output term). Fails when any
 *   tracked `*.expected.json` survives, naming each straggler + its
 *   `*.golden.json` target.
 *   Reuses the `goldenTarget` predicate from the `golden-fixture-naming-guard`
 *   hook (imported directly — `runHook` is entrypoint-guarded, so importing the
 *   hook is a no-op) so the write-time guard and this belt scan can never
 *   diverge on what counts as a violation. Detail:
 *   docs/agents.md/fleet/golden-fixtures.md.
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { goldenTarget } from '../../../.claude/hooks/fleet/_shared/golden-fixture-target.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

export interface GoldenViolation {
  file: string
  target: string
}

export function findViolations(files: readonly string[]): GoldenViolation[] {
  const violations: GoldenViolation[] = []
  for (let i = 0, { length } = files; i < length; i += 1) {
    const file = files[i]!
    const target = goldenTarget(file)
    if (target) {
      violations.push({ file, target })
    }
  }
  return violations
}

export function trackedExpectedJsonFiles(rootDir: string): string[] {
  const result = spawnSync('git', ['ls-files', '*.expected.json'], {
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
  const violations = findViolations(trackedExpectedJsonFiles(REPO_ROOT))
  if (violations.length === 0) {
    logger.success('All golden fixtures are named *.golden.json')
    return
  }
  logger.fail('Test fixture(s) named *.expected.json — rename to *.golden.json')
  logger.log('')
  for (let i = 0, { length } = violations; i < length; i += 1) {
    const violation = violations[i]!
    logger.log(`  ${violation.file}`)
    logger.log(`    → ${violation.target}`)
  }
  logger.log('')
  logger.log('  Also update the loader that reads these fixtures.')
  logger.log('  Detail: docs/agents.md/fleet/golden-fixtures.md')
  process.exitCode = 1
}

if (isMainModule(import.meta.url)) {
  main()
}
