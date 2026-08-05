/*
 * @file The floor under every Socket catalog pin: an update may RAISE a pin,
 *   never lower one.
 *
 *   The observed downgrade came from the fleet-pin lockstep, not from taze.
 *   `update.mts` mirrors the canonical `.config/fleet/pnpm-workspace.fleet.yaml`
 *   into the live workspace, and a member whose copy has not been cascaded
 *   since the last Socket release still names the OLDER version. The lockstep
 *   then faithfully pulls the live pin DOWN to match a stale source — a repo
 *   correctly tracking 6.5.3 gets rolled back to 6.5.2 by a sync that believes
 *   it is restoring canonical truth.
 *
 *   taze itself is exonerated: its `--exclude` handles the Socket globs, and it
 *   auto-detects `maturityPeriodExclude` from the workspace's
 *   `minimumReleaseAgeExclude`, so a Socket package is already cooldown-exempt.
 *   Verified by running taze read-only with its debug channel on.
 *
 *   Fleet law already says a Socket-published pin never moves down and that the
 *   only sanctioned lower pin is a `FLEET_CATALOG_HOLDS` entry. This module is
 *   that law applied at WRITE time. `socket-pins-are-never-lowered` still runs
 *   as the gate, but a gate that fires after the generator has already written
 *   the downgrade leaves an operator hand-fixing a machine's output — and the
 *   hand-fix is where a rollback gets committed by accident.
 *
 *   The comparison lives here rather than in the check that reports it so the
 *   generator and the gate share one definition of "moved down" and cannot
 *   drift apart.
 *
 *   Pure except for `applyCatalogPinFloor`, the one thin fs applier.
 */

import { readFileSync } from 'node:fs'

import { gt } from '@socketsecurity/lib-stable/versions/compare'
import { isValidVersion } from '@socketsecurity/lib-stable/versions/parse'

import { getCatalogHold } from '../constants/catalog-holds.mts'
import { isSocketSourcedPackage } from '../constants/socket-scopes.mts'
import { writeThroughMirrorLock } from '../_shared/mirror-lock.mts'
import { parseCatalogBlock, spliceCatalogEntry } from './workspace-yaml.mts'

/**
 * A pin whose proposed version sits below its committed one.
 */
export interface PinDowngrade {
  readonly committed: string
  readonly name: string
  readonly proposed: string
}

/**
 * The version a catalog value pins, or undefined when it pins no concrete
 * version. Handles the bare form (`4.1.3`) and the `-stable` alias form
 * (`npm:@socketsecurity/sdk@4.1.3`), and skips `catalog:` / `false`.
 */
export function catalogPinnedVersion(value: string): string | undefined {
  const raw = value.trim().replace(/^['"]|['"]$/g, '')
  if (!raw || raw === 'catalog:' || raw === 'false') {
    return undefined
  }
  const aliased = raw.startsWith('npm:')
    ? raw.slice(raw.lastIndexOf('@') + 1)
    : raw
  return isValidVersion(aliased) ? aliased : undefined
}

/**
 * Socket-published pins that moved DOWN from `committed` to `proposed`, minus
 * any the update script's holds sanction. Pure — callers supply both catalogs.
 */
export function findSocketPinDowngrades(
  committed: ReadonlyMap<string, string>,
  proposed: ReadonlyMap<string, string>,
): PinDowngrade[] {
  const downgrades: PinDowngrade[] = []
  for (const { 0: name, 1: proposedValue } of proposed) {
    if (!isSocketSourcedPackage(name)) {
      continue
    }
    const committedValue = committed.get(name)
    if (committedValue === undefined) {
      // Absent from HEAD: a new pin, not a downgrade.
      continue
    }
    const before = catalogPinnedVersion(committedValue)
    const after = catalogPinnedVersion(proposedValue)
    if (before === undefined || after === undefined || !gt(before, after)) {
      continue
    }
    // A hold is the update script's own sanctioned lower pin. Landing at or
    // below it is the documented case this deliberately allows.
    const hold = getCatalogHold(name)
    if (hold && !gt(after, hold.heldAt)) {
      continue
    }
    downgrades.push({ committed: before, name, proposed: after })
  }
  return downgrades
}

/**
 * `version` rendered in the SHAPE `currentValue` already uses. A `-stable`
 * alias must stay an alias — rewriting `npm:@socketsecurity/lib@6.5.2` to a
 * bare `6.5.3` would turn the alias into a second plain pin of a package that
 * has no `-stable` release, and the install would fail on a version that never
 * existed.
 */
export function restoreCatalogPinValue(
  currentValue: string,
  version: string,
): string {
  const raw = currentValue.trim().replace(/^['"]|['"]$/g, '')
  if (raw.startsWith('npm:')) {
    return `'${raw.slice(0, raw.lastIndexOf('@'))}@${version}'`
  }
  return version
}

/**
 * `content` with every downgraded pin restored to its committed version,
 * preserving each entry's existing shape and quoting. Idempotent: re-running
 * over already-restored text changes nothing. Pure.
 */
export function revertPinDowngrades(
  content: string,
  downgrades: readonly PinDowngrade[],
): string {
  let out = content
  for (let i = 0, { length } = downgrades; i < length; i += 1) {
    const downgrade = downgrades[i]!
    // Re-read per iteration: each splice rewrites the text, and the value's
    // shape is what decides how the restored version is rendered.
    const current = parseCatalogBlock(out)[downgrade.name]
    if (current === undefined) {
      continue
    }
    out = spliceCatalogEntry(
      out,
      downgrade.name,
      restoreCatalogPinValue(current, downgrade.committed),
    )
  }
  return out
}

/**
 * Restore every downgraded pin in `file` IN PLACE, writing only when something
 * changed. Returns the downgrades actually reverted. The one fs touch in this
 * module; the comparison and the rewrite above stay pure.
 */
export function applyCatalogPinFloor(
  file: string,
  downgrades: readonly PinDowngrade[],
): PinDowngrade[] {
  if (!downgrades.length) {
    return []
  }
  const original = readFileSync(file, 'utf8')
  const text = revertPinDowngrades(original, downgrades)
  if (text === original) {
    return []
  }
  writeThroughMirrorLock(file, text)
  return [...downgrades]
}
