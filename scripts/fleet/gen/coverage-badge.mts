#!/usr/bin/env node
/**
 * @file Regenerate the repo-local coverage badge from the latest coverage run.
 *   Reads the line-coverage total from
 *   `node_modules/.cache/fleet/coverage/coverage-summary.json` (the vitest
 *   `json-summary` reporter), renders the optimized badge SVG to
 *   `assets/repo/badges/coverage.svg`, and migrates a README still carrying the
 *   retired shields.io badge line — or the legacy pre-badges/ asset path — to
 *   `![Coverage](assets/repo/badges/coverage.svg)`. Part of the pre-bump wave:
 *   after `pnpm run cover` passes, run this to refresh the badge, then commit
 *   it. `coverage-badge-is-current` (in `check --all`) fails the gate if the
 *   badge drifts from the coverage data, so this is the canonical way to fix
 *   it. Usage: node scripts/fleet/gen/coverage-badge.mts [--check] (no flag)
 *   write assets/repo/badges/coverage.svg (and README.md when migrating).
 *   --check exit 1 if the badge WOULD change (dry-run; mirrors the check). Exit
 *   codes: 0 — badge written (or already current under --check); 1 — no
 *   coverage data (run `pnpm run cover` first), no badge in README, or (under
 *   --check) the badge is stale.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  badgeAssetPath,
  coverageBadgeSvg,
  migrateReadmeBadge,
  readCoveragePct,
  readmeBadgeForm,
} from '../lib/coverage-badge.mts'
import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

export interface MakeCoverageBadgeConfig {
  // Dry-run: report staleness via the exit code, write nothing.
  check?: boolean | undefined
  // The repo to operate on. main() passes REPO_ROOT; tests pass a tmp repo.
  repoRoot: string
}

/**
 * Regenerate (or, under `check`, verify) the repo-local coverage badge.
 * Returns the process exit code: 0 on success/current, 1 on a missing
 * precondition or (under `check`) a stale badge.
 */
export function makeCoverageBadge(config: MakeCoverageBadgeConfig): number {
  const cfg = { __proto__: null, check: false, ...config }
  const readmePath = path.join(cfg.repoRoot, 'README.md')
  if (!existsSync(readmePath)) {
    logger.error(
      'gen/coverage-badge: no README.md at the repo root — nothing to update.',
    )
    return 1
  }
  const readme = readFileSync(readmePath, 'utf8')
  if (!readmeBadgeForm(readme)) {
    logger.error(
      'gen/coverage-badge: README.md has no `![Coverage](assets/repo/badges/coverage.svg)` badge (nor a migratable retired form) to update. Add the canonical badge line (see template/README.md) or remove this from the bump wave.',
    )
    return 1
  }
  const pct = readCoveragePct(cfg.repoRoot)
  if (pct === undefined) {
    logger.error(
      // oxlint-disable-next-line socket/prefer-node-modules-dot-cache -- socket-lint FP: the string already targets node_modules/.cache/ — it's a human-facing message, and the rule's string matcher can't see the node_modules/ prefix on the same path.
      'gen/coverage-badge: no coverage data at node_modules/.cache/fleet/coverage/coverage-summary.json. Run `pnpm run cover` first (the json-summary reporter emits it), then re-run.',
    )
    return 1
  }
  const svgPath = badgeAssetPath(cfg.repoRoot)
  const nextSvg = coverageBadgeSvg(pct)
  const currentSvg = existsSync(svgPath)
    ? readFileSync(svgPath, 'utf8')
    : undefined
  const nextReadme = migrateReadmeBadge(readme, nextSvg)
  if (nextSvg === currentSvg && nextReadme === readme) {
    if (!cfg.check) {
      logger.success(
        `gen/coverage-badge: badge already current at ${Math.round(pct)}%.`,
      )
    }
    return 0
  }
  if (cfg.check) {
    logger.error(
      `gen/coverage-badge: the coverage badge is stale (coverage is ${Math.round(pct)}%). Run \`node scripts/fleet/gen/coverage-badge.mts\` and commit.`,
    )
    return 1
  }
  mkdirSync(path.dirname(svgPath), { recursive: true })
  writeFileSync(svgPath, nextSvg)
  if (nextReadme !== readme) {
    writeFileSync(readmePath, nextReadme)
    logger.success(
      'gen/coverage-badge: migrated the README badge line to the local asset reference.',
    )
  }
  logger.success(
    `gen/coverage-badge: coverage badge set to ${Math.round(pct)}% (assets/repo/badges/coverage.svg).`,
  )
  return 0
}

function main(): void {
  process.exitCode = makeCoverageBadge({
    check: process.argv.includes('--check'),
    repoRoot: REPO_ROOT,
  })
}

if (isMainModule(import.meta.url)) {
  main()
}
