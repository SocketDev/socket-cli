#!/usr/bin/env node
/*
 * @file Commit-time gate: the repo-local coverage badge matches the latest
 *   coverage run. The README references `assets/repo/badges/coverage.svg` (a
 *   generated, optimized SVG — no third-party badge host) and the SVG's
 *   stamped percent must equal the rounded line-coverage total from
 *   `node_modules/.cache/fleet/coverage/coverage-summary.json` (the vitest
 *   json-summary reporter). The
 *   commit-time twin of `gen/coverage-badge.mts --check`; they share
 *   `lib/coverage-badge.mts` so the writer and the gate can't disagree.
 *
 *   Fails-open (exit 0, no finding) when the badge can't be meaningfully checked:
 *     - no README badge in either form (a repo that opted out);
 *     - the badge SVG is still the "n/a" placeholder (seeded, never measured);
 *     - no coverage-summary.json (a lint/type CI lane that didn't run coverage,
 *       or a fresh clone). Coverage drift is caught the moment cover IS run.
 *
 *   Fails loud when:
 *     - the README still carries the retired shields.io badge AND coverage
 *       data exists (run gen/coverage-badge to migrate);
 *     - the README references the badge asset but the SVG file is missing or
 *       not a generated badge (broken image in the published README);
 *     - the SVG percent disagrees with the coverage total.
 *
 *   Exit codes: 0 — badge current OR not checkable; 1 — stale/broken (run
 *   `node scripts/fleet/gen/coverage-badge.mts`).
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  BADGE_PLACEHOLDER,
  badgeAssetPath,
  parseBadgeSvgValue,
  readCoveragePct,
  readmeBadgeForm,
} from '../lib/coverage-badge.mts'
import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

const FIX_HINT =
  // oxlint-disable-next-line socket/prefer-node-modules-dot-cache -- socket-lint FP: the string already targets node_modules/.cache/ — it's a human-facing message, and the rule's string matcher can't see the node_modules/ prefix on the same path.
  '  Fix: run `node scripts/fleet/gen/coverage-badge.mts` and commit the refreshed badge (it regenerates from node_modules/.cache/fleet/coverage/coverage-summary.json).'

export interface CoverageBadgeCheckOptions {
  // Suppress the success line (check --all batch mode).
  quiet?: boolean | undefined
  // The repo to check. main() passes REPO_ROOT; tests pass a tmp repo.
  repoRoot: string
}

/**
 * Verify the repo-local coverage badge against the latest coverage run.
 * Returns the process exit code: 0 — current or not checkable (fail-open);
 * 1 — stale or broken.
 */
export function checkCoverageBadgeIsCurrent(
  config: CoverageBadgeCheckOptions,
): number {
  const cfg = { __proto__: null, quiet: false, ...config }
  const readmePath = path.join(cfg.repoRoot, 'README.md')
  if (!existsSync(readmePath)) {
    return 0
  }
  const form = readmeBadgeForm(readFileSync(readmePath, 'utf8'))
  if (!form) {
    // No badge in either form — a repo that opted out.
    return 0
  }
  const pct = readCoveragePct(cfg.repoRoot)
  // 'img' (current) and 'markdown' (legacy-but-valid; gen/coverage-badge
  // migrates it to <img> opportunistically on the next cover run) both point at
  // the same asset — verify them below. Only the truly-retired external/legacy
  // forms fail the gate, so flipping the current form to <img> never breaks a
  // member that still carries the markdown line.
  if (form === 'legacy-asset' || form === 'shields') {
    if (pct === undefined) {
      // Retired form, but no coverage run on this tree to regenerate from —
      // the migration lands with the repo's next cover run.
      return 0
    }
    logger.fail(
      '[check-coverage-badge-is-current] README still uses a retired coverage-badge form (shields.io or the legacy pre-badges/ path) — the badge is a repo-local SVG at assets/repo/badges/coverage.svg (run gen/coverage-badge to migrate).',
    )
    logger.error(FIX_HINT)
    return 1
  }
  const svgPath = badgeAssetPath(cfg.repoRoot)
  if (!existsSync(svgPath)) {
    logger.fail(
      '[check-coverage-badge-is-current] README references assets/repo/badges/coverage.svg but the file does not exist — the published README shows a broken image.',
    )
    logger.error(FIX_HINT)
    return 1
  }
  const value = parseBadgeSvgValue(readFileSync(svgPath, 'utf8'))
  if (value === undefined) {
    logger.fail(
      '[check-coverage-badge-is-current] assets/repo/badges/coverage.svg is not a generated coverage badge (no `aria-label="coverage: …"` stamp).',
    )
    logger.error(FIX_HINT)
    return 1
  }
  if (value === BADGE_PLACEHOLDER) {
    // Seeded-but-never-measured — nothing to verify.
    return 0
  }
  if (pct === undefined) {
    // No coverage run on this tree (lint/type lane, fresh clone) — fail open.
    return 0
  }
  const actual = Math.round(pct)
  const shown = Number.parseInt(value, 10)
  if (shown !== actual) {
    logger.fail(
      `[check-coverage-badge-is-current] the coverage badge shows ${shown}% but coverage is ${actual}%.`,
    )
    logger.error(FIX_HINT)
    return 1
  }
  if (!cfg.quiet) {
    logger.success(
      `[check-coverage-badge-is-current] coverage badge matches coverage (${actual}%).`,
    )
  }
  return 0
}

function main(): void {
  process.exitCode = checkCoverageBadgeIsCurrent({
    quiet: process.argv.includes('--quiet'),
    repoRoot: REPO_ROOT,
  })
}

if (isMainModule(import.meta.url)) {
  main()
}
