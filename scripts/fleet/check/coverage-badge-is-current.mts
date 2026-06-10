#!/usr/bin/env node
/**
 * @file Commit-time gate: the README coverage badge matches the latest coverage
 *   run. When `coverage/coverage-summary.json` exists (the vitest json-summary
 *   reporter) AND the README carries a POPULATED `![Coverage](…coverage-NN%…)`
 *   badge, the badge's percent must equal the rounded line-coverage total. The
 *   commit-time twin of `make-coverage-badge.mts --check`; they share
 *   `lib/coverage-badge.mts` so the writer and the gate can't disagree.
 *
 *   Fails-open (exit 0, no finding) when the badge can't be meaningfully checked:
 *     - no README badge (a repo that opted out);
 *     - the badge is still the `<PCT>` placeholder (seeded, never measured);
 *     - no coverage-summary.json (a lint/type CI lane that didn't run coverage,
 *       or a fresh clone). Coverage drift is caught the moment cover IS run.
 *
 *   Exit codes: 0 — badge current OR not checkable; 1 — badge percent disagrees
 *   with the coverage total (run `node scripts/fleet/make-coverage-badge.mts`).
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  BADGE_PLACEHOLDER,
  parseBadge,
  readCoveragePct,
} from '../lib/coverage-badge.mts'
import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const readmePath = path.join(REPO_ROOT, 'README.md')
  if (!existsSync(readmePath)) {
    return
  }
  const badge = parseBadge(readFileSync(readmePath, 'utf8'))
  if (!badge || badge.pct === BADGE_PLACEHOLDER) {
    // No badge, or seeded-but-never-measured — nothing to verify.
    return
  }
  const pct = readCoveragePct(REPO_ROOT)
  if (pct === undefined) {
    // No coverage run on this tree (lint/type lane, fresh clone) — fail open.
    return
  }
  const actual = Math.round(pct)
  const shown = Number(badge.pct)
  if (shown !== actual) {
    logger.fail(
      `[check-coverage-badge-is-current] README coverage badge shows ${shown}% but coverage is ${actual}%.`,
    )
    logger.error(
      '  Fix: run `node scripts/fleet/make-coverage-badge.mts` and commit the refreshed README (the badge regenerates from coverage/coverage-summary.json).',
    )
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      `[check-coverage-badge-is-current] README coverage badge matches coverage (${actual}%).`,
    )
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
