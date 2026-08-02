#!/usr/bin/env node
/**
 * @file Regenerate the repo-local coverage badge from the latest coverage run.
 *   Reads the line-coverage total from
 *   `.cache/fleet/coverage/coverage-summary.json` (the vitest
 *   `json-summary` reporter), renders the optimized badge SVG to
 *   `assets/repo/badges/coverage.svg`, and migrates a README still carrying an
 *   older badge line — the retired shields.io badge, the legacy pre-badges/
 *   asset path, the `![]` markdown form, or a relative-src `<img>` — to the
 *   current dimensioned `<img>` at the asset's absolute raw-GitHub url (the
 *   only src that also renders on the npm package page). Part of the pre-bump
 *   wave:
 *   after `pnpm run cover` passes, run this to refresh the badge, then commit
 *   it. `coverage-badge-is-current` (in `check --all`) fails the gate if the
 *   badge drifts from the coverage data, so this is the canonical way to fix
 *   it. Usage: node scripts/fleet/gen/coverage-badge.mts [--check], no flag
 *   write assets/repo/badges/coverage.svg (and README.md when migrating).
 *   --check exit 1 if the badge WOULD change (dry-run; mirrors the check). Exit
 *   codes: 0 — badge written (or already current under --check); 1 — no
 *   coverage data (run `pnpm run cover` first), no badge in README, or (under
 *   --check) the badge is stale.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
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
import {
  missingGitHubSlugMessage,
  repoGitHubSlug,
} from '../_shared/github-raw-url.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { writeThroughMirrorLock } from '../_shared/mirror-lock.mts'

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
      'gen/coverage-badge: README.md has no coverage badge (nor a migratable retired form) to update. Add the canonical badge line (see template/README.md) or remove this from the bump wave.',
    )
    return 1
  }
  const pct = readCoveragePct(cfg.repoRoot)
  if (pct === undefined) {
    logger.error(
      'gen/coverage-badge: no coverage data at .cache/fleet/coverage/coverage-summary.json. Run `pnpm run cover` first (the json-summary reporter emits it), then re-run.',
    )
    return 1
  }
  // The README ref is an absolute raw-GitHub url, so the badge renders on the
  // npm package page too — which means the repo slug is a hard requirement, not
  // a nice-to-have. No relative fallback: it would silently reship the broken
  // npm image this url exists to fix.
  const slug = repoGitHubSlug(cfg.repoRoot)
  if (slug === undefined) {
    logger.error(
      `gen/coverage-badge: ${missingGitHubSlugMessage(cfg.repoRoot)}`,
    )
    return 1
  }
  const svgPath = badgeAssetPath(cfg.repoRoot)
  const nextSvg = coverageBadgeSvg(pct)
  const currentSvg = existsSync(svgPath)
    ? readFileSync(svgPath, 'utf8')
    : undefined
  const nextReadme = migrateReadmeBadge(readme, slug, nextSvg)
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
  writeThroughMirrorLock(svgPath, nextSvg)
  if (nextReadme !== readme) {
    writeThroughMirrorLock(readmePath, nextReadme)
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
