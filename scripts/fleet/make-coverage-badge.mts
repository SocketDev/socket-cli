#!/usr/bin/env node
/**
 * @file Regenerate the README coverage badge from the latest coverage run.
 *   Reads the line-coverage total from `coverage/coverage-summary.json` (the
 *   vitest `json-summary` reporter) and rewrites the README's
 *   `![Coverage](https://img.shields.io/badge/coverage-<PCT>%25-<color>)` badge
 *   to that percent + its bucket color. Part of the pre-bump wave: after
 *   `pnpm run cover` passes, run this to refresh the badge, then commit it.
 *   `coverage-badge-is-current` (in `check --all`) fails the gate if the badge
 *   drifts from the coverage data, so this is the canonical way to fix it.
 *
 *   Usage: node scripts/fleet/make-coverage-badge.mts [--check]
 *     (no flag) rewrite README.md in place.
 *     --check   exit 1 if the badge WOULD change (dry-run; mirrors the check).
 *
 *   Exit codes: 0 — badge written (or already current under --check); 1 — no
 *   coverage data (run `pnpm run cover` first), no badge in README, or (under
 *   --check) the badge is stale.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  parseBadge,
  readCoveragePct,
  writeBadge,
} from './lib/coverage-badge.mts'
import { REPO_ROOT } from './paths.mts'

const logger = getDefaultLogger()

function main(): void {
  const check = process.argv.includes('--check')
  const readmePath = path.join(REPO_ROOT, 'README.md')
  if (!existsSync(readmePath)) {
    logger.error(
      'make-coverage-badge: no README.md at the repo root — nothing to update.',
    )
    process.exitCode = 1
    return
  }
  const readme = readFileSync(readmePath, 'utf8')
  if (!parseBadge(readme)) {
    logger.error(
      'make-coverage-badge: README.md has no `![Coverage](…shields.io…)` badge to update. Add the canonical badge line (see template/README.md) or remove this from the bump wave.',
    )
    process.exitCode = 1
    return
  }
  const pct = readCoveragePct(REPO_ROOT)
  if (pct === undefined) {
    logger.error(
      'make-coverage-badge: no coverage data at coverage/coverage-summary.json. Run `pnpm run cover` first (the json-summary reporter emits it), then re-run.',
    )
    process.exitCode = 1
    return
  }
  const next = writeBadge(readme, pct)
  if (next === readme) {
    if (!check) {
      logger.success(
        `make-coverage-badge: badge already current at ${Math.round(pct)}%.`,
      )
    }
    return
  }
  if (check) {
    logger.error(
      `make-coverage-badge: README coverage badge is stale (coverage is ${Math.round(pct)}%). Run \`node scripts/fleet/make-coverage-badge.mts\` and commit.`,
    )
    process.exitCode = 1
    return
  }
  writeFileSync(readmePath, next)
  logger.success(
    `make-coverage-badge: README coverage badge set to ${Math.round(pct)}%.`,
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
