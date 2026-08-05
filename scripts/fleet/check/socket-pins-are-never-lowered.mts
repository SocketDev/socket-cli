#!/usr/bin/env node
/*
 * @file Release/CI gate: no Socket-published catalog pin moves DOWN relative to
 *   the committed tree. Socket packages ship through our own provenance
 *   pipeline and are soak-exempt, so the fleet always takes the newest one —
 *   "when two repos pin different versions, opt for the latest". A downgrade is
 *   therefore never routine maintenance; it is someone routing around a broken
 *   release by hand.
 *
 *   The shape it exists for: a browser-side consumer broke on a fresh sdk, and
 *   the reflex was to pin the whole fleet back one patch. That fixed one repo
 *   and desynced every other — a lowered base version leaves each member's
 *   `-stable` alias pointing at the version that WAS latest, and
 *   `stable-aliases-match-base` reds the pair fleet-wide. The real repair
 *   belongs upstream in the package that regressed, not in a fleet-wide pin
 *   rollback.
 *
 *   THE SANCTIONED EXCEPTION is a `FLEET_CATALOG_HOLDS` entry — the update
 *   script's own setting. A hold names `heldAt`, a `reason`, and the
 *   `releaseWhen` condition that lifts it, and `fleet-pins.mts` already refuses
 *   to ratchet past one. A pin at or below its hold passes here; a pin lowered
 *   with NO hold behind it fails. That keeps the deliberate, documented case
 *   open and closes the silent one.
 *
 *   Compares the working tree against `HEAD`, so it catches a hand edit, a
 *   cascade splicing an older canonical value forward, and a merge alike. A
 *   package absent from HEAD is new, not a downgrade.
 *
 *   The comparison itself lives in `lib/catalog-pin-floor.mts`, shared with
 *   `update.mts`, which applies the same rule at write time so taze can never
 *   land a downgrade for this gate to find. One definition of "moved down",
 *   used by the generator and the gate alike.
 *
 *   Exit: 0 — no Socket pin moved down, or none could be compared; 1 — a
 *   Socket pin is below its committed value with no hold behind it.
 *   Usage: node scripts/fleet/check/socket-pins-are-never-lowered.mts [--quiet]
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { catalogsForDowngradeCheck } from '../lib/catalog-diff.mts'
import { findSocketPinDowngrades } from '../lib/catalog-pin-floor.mts'
import type { PinDowngrade } from '../lib/catalog-pin-floor.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

export function formatDowngradeFailure(
  downgrades: readonly PinDowngrade[],
): string {
  const lines = [
    '✖ [check-socket-pins-are-never-lowered] a Socket package pin moved DOWN.',
    '',
    '  Socket packages are soak-exempt and always take the latest — a lower',
    '  pin desyncs every member’s `-stable` alias from its base and reds the',
    '  fleet. Fix the package that regressed, do not roll the fleet back.',
    '',
  ]
  for (let i = 0, { length } = downgrades; i < length; i += 1) {
    const d = downgrades[i]!
    lines.push(
      `    - ${d.name}: committed ${d.committed}, proposed ${d.proposed}`,
    )
  }
  lines.push(
    '',
    '  Fix: restore the higher pin (base AND its `-stable` alias together).',
    '  If the newer release is genuinely broken, add a FLEET_CATALOG_HOLDS',
    '  entry naming heldAt, the reason, and the releaseWhen that lifts it —',
    '  that is the sanctioned lower pin, and this gate honors it.',
  )
  return lines.join('\n')
}

export function reportSocketPinDowngrades(
  downgrades: readonly PinDowngrade[],
  options?: { quiet?: boolean | undefined } | undefined,
): number {
  const opts = { __proto__: null, ...options } as typeof options
  const quiet = opts?.quiet ?? false
  if (!downgrades.length) {
    if (!quiet) {
      logger.success('no Socket package pin moved down')
    }
    return 0
  }
  logger.error(formatDowngradeFailure(downgrades))
  return 1
}

// Returns the exit code rather than assigning `process.exitCode` — runMain
// overwrites the latter with 0 when main resolves undefined, which turns a real
// finding into a silent pass.
export async function main(): Promise<number> {
  const quiet = process.argv.includes('--quiet')
  const pair = await catalogsForDowngradeCheck()
  if (!pair) {
    if (!quiet) {
      logger.info('no committed catalog to compare against; nothing to check')
    }
    return 0
  }
  return reportSocketPinDowngrades(
    findSocketPinDowngrades(pair.committed, pair.proposed),
    { quiet },
  )
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks no Socket-published catalog pin moves down from the committed tree',
  help: `Usage: node scripts/fleet/check/socket-pins-are-never-lowered.mts [flags]
  --quiet  suppress the success message`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
