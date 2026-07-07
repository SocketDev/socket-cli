#!/usr/bin/env node
/*
 * @file `check --all` gate: package.json's `devEngines.packageManager` +
 *   `engines.pnpm` + `engines.npm` derive from the versions authored in
 *   external-tools.json (the single source of truth for the package-manager
 *   pins). Corepack is disabled fleet-wide — there is no `packageManager` field;
 *   the check also flags a legacy `packageManager` still present as drift.
 *
 *   Drift is DIRECTIONAL. A pin that TRAILS the source (external-tools.json is
 *   newer — a wheelhouse package-manager bump that has not cascaded into this
 *   repo yet) WARNS and passes: the install pulls the newer source version and
 *   a cascade reconciles the pin, so failing would block unrelated member PRs
 *   during a rollout window. A pin AHEAD of the source (or otherwise
 *   inconsistent — a hand-edit, or a version the install cannot provide) FAILS.
 *   Fix real drift with `node scripts/fleet/sync-package-manager-pins.mts`.
 *
 *   Usage: node scripts/fleet/check/package-manager-pins-are-synced.mts [--quiet]
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import {
  applyPins,
  classifyPinDrift,
  derivePins,
  formatDrift,
  readToolVersions,
} from '../sync-package-manager-pins.mts'
import type { PinDrift } from '../sync-package-manager-pins.mts'

const logger = getDefaultLogger()

/**
 * The package.json pin fields that disagree with external-tools.json (empty =
 * in sync). Pure: re-derives the expected pins and diffs against package.json.
 * The pnpm floor is read from `package.json`'s own `engines.pnpm` (the `>=`
 * floor) rather than derived from the exact pnpm version — decoupled so a pnpm
 * bump doesn't re-pin the floor.
 */
export function findPinDrift(repoRoot: string): PinDrift[] {
  const ext = JSON.parse(
    readFileSync(
      path.join(repoRoot, 'scripts/fleet/setup/external-tools.json'),
      'utf8',
    ),
  ) as Record<string, unknown>
  const { npmVersion, pnpmVersion } = readToolVersions(ext)
  const pkg = JSON.parse(
    readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
  ) as Record<string, unknown>
  const engines = pkg['engines']
  const pnpmFloorRaw =
    engines && typeof engines === 'object'
      ? (engines as Record<string, unknown>)['pnpm']
      : undefined
  const pnpmFloor =
    typeof pnpmFloorRaw === 'string'
      ? /^>=([0-9.]+)$/.exec(pnpmFloorRaw)?.[1]
      : undefined
  // applyPins mutates the throwaway parsed object; we only want its drift list.
  return applyPins(pkg, derivePins(pnpmVersion, npmVersion, { pnpmFloor }))
}

function main(): number {
  const drift = findPinDrift(REPO_ROOT)
  const driftClass = classifyPinDrift(drift)
  if (driftClass === 'behind') {
    logger.warn(
      '[package-manager-pins-are-synced] package.json pins trail external-tools.json — the wheelhouse bumped the package manager and this repo has not cascaded yet:',
    )
    logger.group()
    for (let i = 0, { length } = drift; i < length; i += 1) {
      logger.warn(formatDrift(drift[i]!))
    }
    logger.groupEnd()
    logger.log(
      'The install uses the newer source version. Cascade the wheelhouse to sync the pin: node scripts/fleet/sync-package-manager-pins.mts (or a full cascade).',
    )
    return 0
  }
  if (driftClass === 'drifted') {
    logger.fail(
      '[package-manager-pins-are-synced] package.json drifted from external-tools.json (the single source):',
    )
    logger.group()
    for (let i = 0, { length } = drift; i < length; i += 1) {
      logger.fail(formatDrift(drift[i]!))
    }
    logger.groupEnd()
    logger.error(
      'Fix: node scripts/fleet/sync-package-manager-pins.mts (regenerates the pins).',
    )
    process.exitCode = 1
    return 1
  }
  if (!process.argv.includes('--quiet')) {
    logger.success(
      '[package-manager-pins-are-synced] package.json pins match external-tools.json.',
    )
  }
  return 0
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main()
}
