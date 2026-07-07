#!/usr/bin/env node
/**
 * @file Freshness gate for llms.txt. Delegates to make-llms-txt.mts --check,
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

const logger = getDefaultLogger()
const quiet = process.argv.includes('--quiet')

const pkgJsonPath = path.join(REPO_ROOT, 'package.json')
const llmsTxtPath = path.join(REPO_ROOT, 'llms.txt')

if (!existsSync(pkgJsonPath)) {
  if (!quiet) logger.info('no package.json — skipping llms.txt check')
  process.exit(0)
}

if (!existsSync(llmsTxtPath)) {
  if (!quiet)
    logger.info('no llms.txt — skipping check (run make-llms-txt to generate)')
  process.exit(0)
}

const result = spawnSync(
  'node',
  ['scripts/fleet/make-llms-txt.mts', '--check', ...(quiet ? ['--quiet'] : [])],
  { stdio: 'inherit' },
)

if (result.status !== 0) {
  process.exitCode = 1
}
