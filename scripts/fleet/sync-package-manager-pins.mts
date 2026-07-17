#!/usr/bin/env node
/*
 * @file Single source of truth for the package-manager version pins. The pnpm
 *   and npm versions are authored ONCE in external-tools.json
 *   (tools.{pnpm,npm}.version); this derives package.json's
 *   `devEngines.packageManager` + `engines.pnpm` + `engines.npm` from them, so
 *   the version is never hand-maintained in three places. Corepack is disabled
 *   fleet-wide — there is NO `packageManager` field; pnpm's native
 *   `devEngines.packageManager` (SemVer range + `onFail: error`) manages the
 *   version. `engines.node` is left untouched (a
 *   separate floor owned by the node-version rule). Run it after a bump
 *   (update-external-tools.mts calls it; `pnpm run update` runs it) to
 *   propagate; the package-manager-pins-are-synced check gates drift in CI.
 *
 *   Drift is DIRECTIONAL. When a pin trails a newer external-tools.json (a
 *   wheelhouse bump not yet cascaded into this repo), the check WARNS and
 *   continues — a cascade reconciles it, and failing would block unrelated
 *   member PRs during a rollout window. A pin AHEAD of the source (or otherwise
 *   inconsistent) still fails. `packageManager` removal + any
 *   `devEngines.packageManager` reshape are advisory, never a hard fail;
 *   `engines.pnpm` carries the `>=<floor>` floor.
 *
 *   Usage: node scripts/fleet/sync-package-manager-pins.mts [--check] [--quiet]
 *     (no flag) rewrite package.json to match external-tools.json
 *     --check     warn on a behind pin, exit non-zero only on real drift
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
// prefer-async-spawn: sync-required - top-level CLI runner, single oxfmt reformat.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { buildOxfmtArgs } from './_shared/format-scope.mts'
import { REPO_ROOT } from './paths.mts'
import { isMainModule } from './_shared/is-main-module.mts'

const logger = getDefaultLogger()

export interface DevEnginesPackageManager {
  name: string
  version: string
  onFail: string
}

export interface ManagerPins {
  devEnginesPnpm: DevEnginesPackageManager
  enginesPnpm: string
  enginesNpm: string
}

export interface PinDrift {
  field: string
  actual: string
  expected: string
}

export type PinDriftClass = 'synced' | 'behind' | 'drifted'

/**
 * Build the major-bounded devEngines range from a floor version:
 * `11.0.5` → `>=11.0.0 <12.0.0`. pnpm's `devEngines.packageManager` (a
 * SemVer range, unlike corepack's exact `packageManager`) accepts this, and
 * `onFail: error` refuses a mismatched pnpm — the fleet provisions pnpm
 * out-of-band (external-tools.json in CI, the racked installer locally), so a
 * surprise download is never wanted. The lower bound is `<major>.0.0` (not the
 * exact floor) so a member on an older cascade still satisfies the range.
 */
export function majorBoundedRange(version: string): string {
  const major = Number(version.split('.')[0])
  return `>=${major}.0.0 <${major + 1}.0.0`
}

/**
 * Derive the package.json pins from the external-tools.json version fields.
 * Corepack is disabled fleet-wide, so there is NO `packageManager` field —
 * pnpm's native `devEngines.packageManager` (a major-bounded SemVer range with
 * `onFail: error`) manages the version instead. `engines.pnpm` carries the
 * `>=<floor>` floor; when `pnpmFloor` is absent it falls back to `pnpmVersion`.
 * `enginesNpm` is the npm floor.
 */
export function derivePins(
  pnpmVersion: string,
  npmVersion: string,
  options?: { pnpmFloor?: string | undefined },
): ManagerPins {
  const opts = { __proto__: null, ...options } as {
    pnpmFloor?: string | undefined
  }
  const pnpmFloor = opts.pnpmFloor ?? pnpmVersion
  return {
    __proto__: null,
    devEnginesPnpm: {
      __proto__: null,
      name: 'pnpm',
      version: majorBoundedRange(pnpmFloor),
      onFail: 'error',
    },
    enginesPnpm: `>=${pnpmFloor}`,
    enginesNpm: `>=${npmVersion}`,
  } as ManagerPins
}

/**
 * Apply derived pins to a parsed package.json object, mutating it in place.
 * Returns the structured list of fields that changed (empty = already in
 * sync). Deletes any legacy `packageManager` (corepack is disabled fleet-wide),
 * writes `devEngines.packageManager`, and touches `engines.{pnpm,npm}`.
 */
export function applyPins(
  pkg: Record<string, unknown>,
  pins: ManagerPins,
): PinDrift[] {
  const drift: PinDrift[] = []
  // Corepack is disabled fleet-wide — strip any legacy exact-pin packageManager.
  if (pkg['packageManager'] !== undefined) {
    drift.push({
      __proto__: null,
      field: 'packageManager',
      actual: String(pkg['packageManager']),
      expected: '(removed — corepack disabled)',
    } as PinDrift)
    delete pkg['packageManager']
  }
  // pnpm's native devEngines.packageManager (SemVer range + onFail: error)
  // replaces corepack's exact packageManager pin.
  const devEngines = (pkg['devEngines'] ?? {}) as Record<string, unknown>
  const wantPm = pins.devEnginesPnpm
  const gotPm = (devEngines['packageManager'] ?? {}) as Record<string, unknown>
  if (
    gotPm['name'] !== wantPm.name ||
    gotPm['version'] !== wantPm.version ||
    gotPm['onFail'] !== wantPm.onFail
  ) {
    drift.push({
      __proto__: null,
      field: 'devEngines.packageManager',
      actual: JSON.stringify(devEngines['packageManager']),
      expected: JSON.stringify(wantPm),
    } as PinDrift)
    devEngines['packageManager'] = {
      __proto__: null,
      name: wantPm.name,
      version: wantPm.version,
      onFail: wantPm.onFail,
    }
    pkg['devEngines'] = devEngines
  }
  const engines = (pkg['engines'] ?? {}) as Record<string, unknown>
  if (engines['pnpm'] !== pins.enginesPnpm) {
    drift.push({
      __proto__: null,
      field: 'engines.pnpm',
      actual: String(engines['pnpm']),
      expected: pins.enginesPnpm,
    } as PinDrift)
    engines['pnpm'] = pins.enginesPnpm
  }
  if (engines['npm'] !== pins.enginesNpm) {
    drift.push({
      __proto__: null,
      field: 'engines.npm',
      actual: String(engines['npm']),
      expected: pins.enginesNpm,
    } as PinDrift)
    engines['npm'] = pins.enginesNpm
  }
  pkg['engines'] = engines
  return drift
}

/**
 * Render a drift entry for logs: `engines.pnpm: >=11.7.0 → >=11.8.0`.
 */
export function formatDrift(drift: PinDrift): string {
  return `${drift.field}: ${drift.actual} → ${drift.expected}`
}

/**
 * Extract a bare `X.Y.Z` from a pin field — handles `pnpm@11.8.0`, `>=11.8.0`,
 * and a plain `11.8.0`. Returns undefined when no version is present (e.g. the
 * field was absent, so `actual` is the string `"undefined"`).
 */
export function extractPinVersion(field: string): string | undefined {
  // One named capture (consumed below): a leading range/prefix is skipped and
  // the X.Y.Z (plus any prerelease/build tail) is captured.
  const match = /(?<version>\d+\.\d+\.\d+(?:[-+][\w.]+)?)/.exec(field)
  return match?.groups?.['version']
}

/**
 * Compare two `X.Y.Z` versions numerically. Returns -1/0/1. Prerelease/build
 * tails are ignored — the package-manager pins are always clean releases.
 */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(part => Number.parseInt(part, 10) || 0)
  const pb = b.split('.').map(part => Number.parseInt(part, 10) || 0)
  for (let i = 0; i < 3; i += 1) {
    const delta = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (delta !== 0) {
      return delta < 0 ? -1 : 1
    }
  }
  return 0
}

/**
 * True when a drift is benign (warn, do not fail). Benign = a pin whose version
 * simply TRAILS the source (external-tools.json is newer — a wheelhouse bump
 * not yet cascaded here); a cascade reconciles it, and failing would block an
 * unrelated member PR during a rollout window. A pin AHEAD of the source, or an
 * invalid shape, is a hard drift.
 *
 * `packageManager` removal (corepack disabled) and any
 * `devEngines.packageManager` reshape are always benign — the devEngines range
 * is major-bounded and advisory, so a member on an older cascade still
 * satisfies it and a later cascade reconciles the exact bytes; neither is ever
 * a hard fail.
 */
export function isBehindSource(drift: PinDrift): boolean {
  if (
    drift.field === 'devEngines.packageManager' ||
    drift.field === 'packageManager'
  ) {
    return true
  }
  const actual = extractPinVersion(drift.actual)
  const expected = extractPinVersion(drift.expected)
  if (!actual || !expected) {
    return false
  }
  return compareSemver(actual, expected) < 0
}

/**
 * Classify a drift set. `synced` = no drift. `behind` = EVERY drift is benign
 * (an engines floor trailing a newer source, or any `packageManager` reshape)
 * → warn, do not fail. `drifted` = at least one engines floor is ahead of the
 * source or otherwise inconsistent (a hand-edit) → fail.
 */
export function classifyPinDrift(drift: readonly PinDrift[]): PinDriftClass {
  if (!drift.length) {
    return 'synced'
  }
  return drift.every(isBehindSource) ? 'behind' : 'drifted'
}

/**
 * Read the pnpm + npm version fields out of an external-tools.json object.
 * Throws a UI-quality error naming the missing field when either is absent.
 */
export function readToolVersions(externalTools: Record<string, unknown>): {
  pnpmVersion: string
  npmVersion: string
} {
  const tools = (externalTools['tools'] ?? {}) as Record<
    string,
    { version?: string | undefined }
  >
  const pnpmVersion = tools['pnpm']?.version
  const npmVersion = tools['npm']?.version
  if (!pnpmVersion || !npmVersion) {
    throw new Error(
      'external-tools.json is missing tools.pnpm.version and/or tools.npm.version — ' +
        'the package-manager pins derive from those two fields.',
    )
  }
  return { pnpmVersion, npmVersion }
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
}

function readPnpmFloor(pkgJson: Record<string, unknown>): string | undefined {
  const engines = pkgJson['engines']
  if (!engines || typeof engines !== 'object') {
    return undefined
  }
  const pnpm = (engines as Record<string, unknown>)['pnpm']
  if (typeof pnpm !== 'string') {
    return undefined
  }
  const match = /^>=([0-9.]+)$/.exec(pnpm)
  return match?.[1]
}

function main(): number {
  const checkOnly = process.argv.includes('--check')
  const quiet = process.argv.includes('--quiet')
  const extPath = path.join(
    REPO_ROOT,
    'scripts/fleet/setup/external-tools.json',
  )
  const pkgPath = path.join(REPO_ROOT, 'package.json')
  const { npmVersion, pnpmVersion } = readToolVersions(readJson(extPath))
  const pkg = readJson(pkgPath)
  const pnpmFloor = readPnpmFloor(pkg)
  const pins = derivePins(pnpmVersion, npmVersion, { pnpmFloor })
  const drift = applyPins(pkg, pins)
  if (!drift.length) {
    if (!quiet) {
      logger.success(
        `[sync-package-manager-pins] package.json pins match external-tools.json (pnpm@${pnpmVersion}, npm@${npmVersion}).`,
      )
    }
    return 0
  }
  if (checkOnly) {
    if (classifyPinDrift(drift) === 'behind') {
      logger.warn(
        '[sync-package-manager-pins] package.json pins trail external-tools.json — a wheelhouse package-manager bump has not cascaded into this repo yet:',
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
    logger.fail(
      '[sync-package-manager-pins] package.json pins drifted from external-tools.json (the single source):',
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
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
  // Re-run the fleet formatter over the freshly-written file: inserting a new
  // top-level key (devEngines) via plain object assignment appends it at the
  // end of enumeration order, which oxfmt's alphabetical package.json sort
  // then flags as a format violation on the very next `pnpm run format:check`.
  // Reformat here so the write already matches what the format gate expects.
  const formatResult = spawnSync('pnpm', buildOxfmtArgs({ files: [pkgPath] }), {
    shell: process.platform === 'win32',
    stdio: 'inherit',
  })
  if (formatResult.status !== 0) {
    logger.warn(
      `[sync-package-manager-pins] oxfmt reformat of package.json exited ${String(formatResult.status)} — run \`pnpm run format\` manually.`,
    )
  }
  logger.success(
    '[sync-package-manager-pins] synced package.json pins from external-tools.json:',
  )
  for (let i = 0, { length } = drift; i < length; i += 1) {
    logger.substep(formatDrift(drift[i]!))
  }
  return 0
}

if (isMainModule(import.meta.url)) {
  main()
}
