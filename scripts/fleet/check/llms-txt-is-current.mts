#!/usr/bin/env node
/**
 * @file Freshness gate for llms.txt. Delegates to gen/llms-txt.mts --check,
 *   which compares the structural skeleton (H1 + section titles + ordered link
 *   name/url pairs) of the committed file against the deterministic extraction.
 *   Prose is never diffed — only structure is compared, so the check is
 *   credential-free and member-safe.
 *   Fail-open policy: when the repo has no package.json or llms.txt, exits 0
 *   (skip) with a note. A bespoke existing file (unrecognized shape) also
 *   exits 0.
 *   Usage: node scripts/fleet/check/llms-txt-is-current.mts [--quiet]
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

export type SkipDecision = { reason: string; skip: true } | { skip: false }

// Fail-open pre-check: skip (with a reason) when the repo carries no
// package.json or no llms.txt yet; otherwise the spawn-out check runs.
export function decideSkip(repoRoot: string): SkipDecision {
  if (!existsSync(path.join(repoRoot, 'package.json'))) {
    return { reason: 'no package.json — skipping llms.txt check', skip: true }
  }
  if (!existsSync(path.join(repoRoot, 'llms.txt'))) {
    return {
      reason: 'no llms.txt — skipping check (run gen/llms-txt to generate)',
      skip: true,
    }
  }
  return { skip: false }
}

// The argv passed to `node scripts/fleet/gen/llms-txt.mts --check`.
export function buildCheckArgs(quiet: boolean): string[] {
  return [
    'scripts/fleet/gen/llms-txt.mts',
    '--check',
    ...(quiet ? ['--quiet'] : []),
  ]
}

export function main(): void {
  const quiet = process.argv.includes('--quiet')
  const decision = decideSkip(REPO_ROOT)
  if (decision.skip) {
    if (!quiet) {
      logger.info(decision.reason)
    }
    return
  }
  const result = spawnSync('node', buildCheckArgs(quiet), { stdio: 'inherit' })
  if (result.status !== 0) {
    process.exitCode = 1
  }
}

if (isMainModule(import.meta.url)) {
  main()
}
