#!/usr/bin/env node
/*
 * @file Parity gate: the soak window must be ONE value everywhere.
 *   `.config/fleet/taze.config.mts` imports `SOAK_DAYS` directly, so it can't
 *   drift. The two DATA files can't import a `.mts` constant, so this check
 *   asserts they match:
 *
 *   - `pnpm-workspace.yaml` `minimumReleaseAge` (minutes) === `SOAK_MINUTES`
 *   - `.npmrc` `min-release-age` (days) === `SOAK_DAYS` Fails loud (What / Where
 *     / Saw-vs-wanted / Fix) on any mismatch. Pure core (extract* +
 *     findSoakInconsistencies) is unit-tested; main() reads the repo's own
 *     files. Usage: node scripts/fleet/check/soak-time-is-consistent.mts
 *     [--quiet]
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { SOAK_DAYS, SOAK_MINUTES } from '../constants/soak.mts'
import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

export interface SoakSurfaces {
  npmrcDays: number | undefined
  pnpmMinutes: number | undefined
  soakDays: number
  soakMinutes: number
}

/**
 * Read `minimumReleaseAge: <n>` (minutes) from a pnpm-workspace.yaml body.
 * A trailing `#` comment (e.g. `minimumReleaseAge: 10080 # 7 days`) is legal
 * YAML and is tolerated.
 */
export function extractPnpmMinimumReleaseAge(yaml: string): number | undefined {
  const match = /^minimumReleaseAge:\s*(\d+)\s*(?:#.*)?$/m.exec(yaml)
  return match ? Number(match[1]) : undefined
}

/**
 * Read `min-release-age=<n>` (days) from an .npmrc body. npm parses `.npmrc`
 * with the `ini` package (`@npmcli/config`), whose `unsafe()` value reader
 * stops at the first unescaped `;` or `#` — so a trailing comment on the same
 * line is legal npmrc syntax and is tolerated here too.
 */
export function extractNpmrcMinReleaseAge(npmrc: string): number | undefined {
  const match = /^min-release-age=(\d+)\s*(?:[;#].*)?$/m.exec(npmrc)
  return match ? Number(match[1]) : undefined
}

/**
 * Mismatches between the data files and the canonical constant. Empty = in
 * sync.
 */
export function findSoakInconsistencies(options: SoakSurfaces): string[] {
  const opts = { __proto__: null, ...options } as SoakSurfaces
  const out: string[] = []
  if (opts.pnpmMinutes !== opts.soakMinutes) {
    out.push(
      `pnpm-workspace.yaml minimumReleaseAge is ${opts.pnpmMinutes ?? '(missing)'}, ` +
        `wanted ${opts.soakMinutes} (SOAK_DAYS ${opts.soakDays} × 1440 minutes).`,
    )
  }
  if (opts.npmrcDays !== opts.soakDays) {
    out.push(
      `.npmrc min-release-age is ${opts.npmrcDays ?? '(missing)'}, ` +
        `wanted ${opts.soakDays} (SOAK_DAYS).`,
    )
  }
  return out
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const pnpmPath = path.join(REPO_ROOT, 'pnpm-workspace.yaml')
  const npmrcPath = path.join(REPO_ROOT, '.npmrc')
  const pnpmMinutes = existsSync(pnpmPath)
    ? extractPnpmMinimumReleaseAge(readFileSync(pnpmPath, 'utf8'))
    : undefined
  const npmrcDays = existsSync(npmrcPath)
    ? extractNpmrcMinReleaseAge(readFileSync(npmrcPath, 'utf8'))
    : undefined
  const issues = findSoakInconsistencies({
    npmrcDays,
    pnpmMinutes,
    soakDays: SOAK_DAYS,
    soakMinutes: SOAK_MINUTES,
  })
  if (issues.length > 0) {
    logger.fail(
      `[soak-time-is-consistent] the soak window drifted from the canonical ` +
        `SOAK_DAYS (scripts/fleet/constants/soak.mts):\n  ` +
        `${issues.join('\n  ')}\n  ` +
        `Fix: update the data file(s) to match SOAK_DAYS (or change SOAK_DAYS, ` +
        `which re-derives every surface).`,
    )
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      `[soak-time-is-consistent] soak window is ${SOAK_DAYS}d everywhere.`,
    )
  }
}

if (isMainModule(import.meta.url)) {
  main()
}
