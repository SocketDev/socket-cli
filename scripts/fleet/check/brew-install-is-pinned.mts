#!/usr/bin/env node
/**
 * @file Fail-closed, fully-offline gate that Homebrew installs resolve only to
 *   soaked versions. Homebrew has no minimum-release-age, so enforcement is a
 *   per-tap SHA pin (`constants/brew-tap-pins.mts`) that CI checks out before a
 *   `brew bundle` install of the committed Brewfile — every version present at
 *   a pin at least `SOAK_DAYS` old is definitionally soaked. This gate asserts
 *   the invariants that keep that true, WITHOUT any network (verifying a pin's
 *   SHA-vs-date against GitHub is the updater's job — `--apply`): (a) the
 *   repo-root Brewfile byte-matches `renderBrewfile` over the freshly
 *   discovered `.github/` brew install sites (drift = a `brew install` was
 *   added without regenerating the manifest); (b) every tap pin's `committedAt`
 *   parses as ISO and is >= `SOAK_DAYS` old; (c) no `.github/` brew install
 *   formula is missing from the Brewfile; and the Brewfile's `# soak-days:`
 *   header equals `SOAK_DAYS` (data-file parity). Enrollment is the Brewfile: a
 *   repo with no repo-root Brewfile has not adopted the pinned-bundle flow, so
 *   the gate no-ops (the cascaded fleet setup action's brew hint strings make
 *   discovery non-empty everywhere, so keying enforcement off discovery alone
 *   would red every unenrolled member). Usage: node
 *   scripts/fleet/check/brew-install-is-pinned.mts [--quiet]
 */

import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { BREW_TAP_PINS } from '../constants/brew-tap-pins.mts'
import { SOAK_DAYS } from '../constants/soak.mts'
import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import {
  brewfilePath,
  dedupeBrewTools,
  findManifestBrewSites,
  parseBrewfile,
  renderBrewfile,
} from '../update/brew.mts'

import type { BrewTapPin } from '../constants/brew-tap-pins.mts'
import type { BrewTool } from '../update/brew.mts'

const DAY_MS = 86_400_000

const logger = getDefaultLogger()

/**
 * A tool's `kind:name` key — the identity the Brewfile and the discovery share.
 */
function toolKey(tool: BrewTool): string {
  return `${tool.cask ? 'cask' : 'brew'}:${tool.name}`
}

/**
 * Drift between the committed Brewfile and a fresh render over the `.github/`
 * brew install sites. A mismatch means someone added a `brew install` (or
 * changed the soak window) without regenerating. Empty when in sync.
 */
export function findBrewfileSyncDrift(
  root: string,
  soakDays: number,
): string[] {
  const expected = renderBrewfile(findManifestBrewSites(root), soakDays)
  const actual = readFileSync(brewfilePath(root), 'utf8')
  if (actual === expected) {
    return []
  }
  return [
    'Brewfile is out of sync with the .github brew install sites — regenerate ' +
      'it (`node scripts/fleet/update/brew.mts --write-manifest --soak-days ' +
      `${soakDays}\`).`,
  ]
}

/**
 * Tap pins whose `committedAt` is unparseable or younger than the soak window.
 * `now` is injected so the gate is testable + deterministic. Empty when all
 * pins are soaked.
 */
export function findStalePinViolations(
  pins: readonly BrewTapPin[],
  soakDays: number,
  now: Date,
): string[] {
  const failures: string[] = []
  for (const pin of pins) {
    const date = new Date(pin.committedAt)
    if (Number.isNaN(date.getTime())) {
      failures.push(
        `${pin.tap}: committedAt '${pin.committedAt}' is not a parseable ISO date.`,
      )
      continue
    }
    const ageDays = (now.getTime() - date.getTime()) / DAY_MS
    if (ageDays < soakDays) {
      failures.push(
        `${pin.tap}: pin is ${ageDays.toFixed(1)}d old — under the ${soakDays}d soak.`,
      )
    }
  }
  return failures
}

/**
 * `.github/` brew install formulae/casks the Brewfile does not declare — a bare
 * install that would resolve outside the pinned bundle. Empty when every
 * discovered tool is in the Brewfile.
 */
export function findBareInstallViolations(root: string): string[] {
  const declared = new Set(
    parseBrewfile(readFileSync(brewfilePath(root), 'utf8')).map(toolKey),
  )
  const failures: string[] = []
  for (const tool of dedupeBrewTools(findManifestBrewSites(root))) {
    if (!declared.has(toolKey(tool))) {
      failures.push(
        `.github installs ${tool.cask ? `cask ${tool.name}` : tool.name} but ` +
          'the Brewfile does not declare it (regenerate the manifest).',
      )
    }
  }
  return failures
}

/**
 * The Brewfile's `# soak-days:` header must equal `SOAK_DAYS` (a Brewfile can't
 * import the constant, so this is the data-file parity assertion). Returns a
 * message when missing or mismatched, else undefined.
 */
export function findSoakDaysParityViolation(
  root: string,
  soakDays: number,
): string | undefined {
  const match = /^#\s*soak-days:\s*(\d+)/m.exec(
    readFileSync(brewfilePath(root), 'utf8'),
  )
  if (!match) {
    return 'Brewfile is missing its `# soak-days:` header.'
  }
  const value = Number(match[1])
  if (value !== soakDays) {
    return `Brewfile soak-days ${value} != SOAK_DAYS ${soakDays}.`
  }
  return undefined
}

/**
 * Every pinning violation for `root`. Pure over injected `pins` + `now` so
 * tests drive it offline. The Brewfile at `root` is assumed to exist (main
 * gates on it); an absent Brewfile means the repo is not enrolled — main
 * no-ops.
 */
export function findBrewPinningViolations(
  root: string,
  pins: readonly BrewTapPin[],
  soakDays: number,
  now: Date,
): string[] {
  const failures = [
    ...findBrewfileSyncDrift(root, soakDays),
    ...findStalePinViolations(pins, soakDays, now),
    ...findBareInstallViolations(root),
  ]
  const parity = findSoakDaysParityViolation(root, soakDays)
  if (parity) {
    failures.push(parity)
  }
  return failures
}

async function main(): Promise<void> {
  const quiet = process.argv.includes('--quiet')
  if (!existsSync(brewfilePath(REPO_ROOT))) {
    if (!quiet) {
      logger.info(
        'brew-install-is-pinned: no repo-root Brewfile (not enrolled).',
      )
    }
    return
  }
  const violations = findBrewPinningViolations(
    REPO_ROOT,
    BREW_TAP_PINS,
    SOAK_DAYS,
    new Date(),
  )
  if (violations.length > 0) {
    logger.fail(
      `[brew-install-is-pinned] ${violations.length} issue(s) — Homebrew ` +
        'installs are not provably pinned to a soaked tap:',
    )
    logger.group()
    for (let i = 0, { length } = violations; i < length; i += 1) {
      logger.error(violations[i]!)
    }
    logger.groupEnd()
    logger.error(
      'Fix: regenerate the Brewfile (`node scripts/fleet/update/brew.mts ' +
        `--write-manifest --soak-days ${SOAK_DAYS}\`) and advance stale pins ` +
        `(\`… --apply --soak-days ${SOAK_DAYS}\`).`,
    )
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      `[brew-install-is-pinned] Brewfile + ${BREW_TAP_PINS.length} tap pin(s) ` +
        `clear the ${SOAK_DAYS}d soak.`,
    )
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(e)
    process.exitCode = 1
  })
}
