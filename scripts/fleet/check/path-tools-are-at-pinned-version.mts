#!/usr/bin/env node
// Fleet check — path-tools-are-at-pinned-version.
//
// Fails LOUD when a fleet-managed tool resolved on PATH is BELOW its pinned
// floor. The fleet racks + shims pnpm / uv onto PATH at pinned versions
// (package.json `engines.pnpm`, external-tools.json `tools.<x>.version`). A
// stray older binary that wins PATH resolution — a Homebrew `uv`, a corepack
// `pnpm` — breaks things SILENTLY: a sub-`engines.pnpm` pnpm makes the cascade
// churn the catalog against a lockfile it then can't refresh (every pnpm op
// hard-fails ERR_PNPM_UNSUPPORTED_ENGINE); a sub-pin `uv` resolves outside the
// soak-locked closure. This catches the downgrade at `check --all` time instead
// of mid-cascade. (It is not hypothetical — a stray pnpm@10.21.0 on PATH did
// exactly this.)
//
// Skips a tool that is not on PATH (absence is a separate concern). Fails ONLY
// when a PRESENT tool reports a version below its floor.
//
// `--fix` heals a below-floor tool that Homebrew provides by running
// `brew upgrade <formula>` (only for floor-pinned tools like node — a stale
// Homebrew node commonly shadows the racked/fnm one; pnpm + uv are exact-pinned
// and racked, so brew's latest would overshoot their pin and they are left for
// the racked installer). A post-upgrade re-check is the real gate: if a
// non-Homebrew binary still wins PATH, it fails LOUD with the manual step.
//
// Usage: node scripts/fleet/check/path-tools-are-at-pinned-version.mts [--quiet] [--fix]

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
// oxlint-disable-next-line socket/prefer-async-spawn -- a sync --version probe in a check; no streaming, just exit status + trimmed stdout.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { lt } from '@socketsecurity/lib-stable/versions/compare'
import { coerceVersion } from '@socketsecurity/lib-stable/versions/parse'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

export interface PathToolPin {
  // The binary name as it resolves on PATH.
  bin: string
  // The minimum acceptable version (`X.Y.Z`), normalized from the pin source.
  floor: string
  // Human-readable origin of the pin, for the failure message.
  source: string
}

/**
 * Normalize a pin (a bare `X.Y.Z` or a range like `>=11.8.0` / `^11`) to its
 * minimum acceptable version. Returns undefined when the pin can't be parsed.
 */
export function floorFromPin(pin: string): string | undefined {
  // coerceVersion extracts the first version from a bare pin OR a range
  // (`^11` / `>=11.8.0` / `~11.8` all coerce to their floor), returning
  // undefined for an unparseable pin.
  return coerceVersion(pin)
}

/**
 * Resolve the PATH-tool floor pins from their canonical sources: - node ←
 * package.json `engines.node` - pnpm ← package.json `engines.pnpm` - uv ←
 * external-tools.json `tools.uv.version`. A source that's absent or
 * unparseable is skipped (no pin → nothing to assert).
 */
export function pathToolPins(repoRoot: string): PathToolPin[] {
  const pins: PathToolPin[] = []
  const readJson = (rel: string): Record<string, unknown> | undefined => {
    const abs = path.join(repoRoot, rel)
    if (!existsSync(abs)) {
      return undefined
    }
    try {
      return JSON.parse(readFileSync(abs, 'utf8')) as Record<string, unknown>
    } catch {
      return undefined
    }
  }
  const pkg = readJson('package.json')
  const engines = pkg?.['engines'] as Record<string, unknown> | undefined
  // node + pnpm both floor-pin via package.json `engines`. A node below the
  // engines floor (e.g. a stale Homebrew node winning PATH over the racked
  // nvm one) trips scripts + hooks that assume the pinned runtime; catch it
  // at gate time like the pnpm downgrade.
  for (const bin of ['node', 'pnpm']) {
    const pin =
      engines && typeof engines[bin] === 'string'
        ? (engines[bin] as string)
        : undefined
    if (!pin) {
      continue
    }
    const floor = floorFromPin(pin)
    if (floor) {
      pins.push({ bin, floor, source: `package.json engines.${bin}` })
    }
  }
  const ext = readJson('external-tools.json')
  const tools = ext?.['tools'] as Record<string, unknown> | undefined
  const uv = tools?.['uv'] as Record<string, unknown> | undefined
  const uvVersion =
    uv && typeof uv['version'] === 'string' ? uv['version'] : undefined
  if (uvVersion) {
    const floor = floorFromPin(uvVersion)
    if (floor) {
      pins.push({
        bin: 'uv',
        floor,
        source: 'external-tools.json tools.uv.version',
      })
    }
  }
  return pins
}

/**
 * The version a tool on PATH reports, or undefined when it's not installed /
 * not on PATH / unparseable. `<bin> --version` output is coerced to a semver
 * (`pnpm` prints `11.8.0`; `uv` prints `uv 0.9.26 (Homebrew …)`).
 */
export function pathToolVersion(bin: string): string | undefined {
  let result: {
    status: number | string | null
    stdout?: string | undefined
    stderr?: string | undefined
  }
  try {
    result = spawnSync(bin, ['--version'], {
      stdioString: true,
    }) as typeof result
  } catch {
    // ENOENT (not on PATH) or spawn error — treat as absent.
    return undefined
  }
  if (result.status !== 0) {
    return undefined
  }
  const out = `${result.stdout ?? ''} ${result.stderr ?? ''}`.trim()
  return coerceVersion(out)
}

export interface FloorViolation {
  bin: string
  found: string
  floor: string
  source: string
}

/**
 * For each pinned PATH tool that IS present, the violation when its version is
 * below the floor. Absent tools and at-or-above-floor tools yield nothing.
 */
export function findBelowFloor(
  pins: readonly PathToolPin[],
  resolve: (bin: string) => string | undefined,
): FloorViolation[] {
  const out: FloorViolation[] = []
  for (let i = 0, { length } = pins; i < length; i += 1) {
    const pin = pins[i]!
    const found = resolve(pin.bin)
    if (found === undefined) {
      continue
    }
    if (lt(found, pin.floor)) {
      out.push({ bin: pin.bin, floor: pin.floor, found, source: pin.source })
    }
  }
  return out
}

// Bins whose pin is a `>=` FLOOR (any newer version satisfies it), so a Homebrew
// `brew upgrade` to the latest is a valid heal. pnpm + uv are pinned to an EXACT
// racked version — brew's latest would overshoot the pin, so they are NOT
// brew-upgradable and keep the racked-installer fix.
export const BREW_UPGRADABLE: ReadonlySet<string> = new Set(['node'])

export type BrewFixPlan =
  | { action: 'skip'; reason: string }
  | { action: 'upgrade'; formula: string }

/**
 * Pure: decide whether a below-floor violation can be healed by `brew upgrade`.
 * Only floor-pinned, brew-provisioned tools qualify; everything else is skipped
 * with a reason (never silently no-op'd).
 */
export function planBrewFix(config: {
  brewAvailable: boolean
  violation: FloorViolation
}): BrewFixPlan {
  const cfg = { __proto__: null, ...config } as typeof config
  const { bin } = cfg.violation
  if (!BREW_UPGRADABLE.has(bin)) {
    return {
      action: 'skip',
      reason: `${bin} is exact-pinned (racked) — reinstall the pinned version via the racked installer, not brew`,
    }
  }
  if (!cfg.brewAvailable) {
    return {
      action: 'skip',
      reason: 'Homebrew (brew) is not on PATH — cannot auto-upgrade',
    }
  }
  return { action: 'upgrade', formula: bin }
}

// True when the `brew` CLI is callable.
function brewAvailable(): boolean {
  try {
    return spawnSync('brew', ['--version'], { stdioString: true }).status === 0
  } catch {
    return false
  }
}

/**
 * `--fix`: bring each below-floor Homebrew tool up via `brew upgrade`, then
 * re-check. Returns the count still below floor after the attempt (0 = healed).
 * The re-check — not the brew exit code — is the gate: `brew upgrade` exits
 * non-zero when a formula is already latest, and a non-Homebrew binary
 * (fnm/nvm) may still win PATH, which the re-check catches and reports LOUD.
 */
export function runBrewFix(violations: readonly FloorViolation[]): number {
  const available = brewAvailable()
  let unresolved = 0
  for (let i = 0, { length } = violations; i < length; i += 1) {
    const v = violations[i]!
    const plan = planBrewFix({ brewAvailable: available, violation: v })
    if (plan.action === 'skip') {
      logger.warn(`[path-tools-are-at-pinned-version] ${v.bin}: ${plan.reason}`)
      unresolved += 1
      continue
    }
    logger.info(
      `[path-tools-are-at-pinned-version] brew upgrade ${plan.formula} (on PATH ${v.found}, floor ${v.floor})…`,
    )
    spawnSync('brew', ['upgrade', plan.formula], { stdio: 'inherit' })
    const now = pathToolVersion(v.bin)
    if (now && !lt(now, v.floor)) {
      logger.success(
        `[path-tools-are-at-pinned-version] ${v.bin} is now ${now} (floor ${v.floor}).`,
      )
      continue
    }
    unresolved += 1
    logger.fail(
      `[path-tools-are-at-pinned-version] ${v.bin} is ${now ?? 'unresolved'} after brew upgrade — still below floor ${v.floor}.\n` +
        `  A non-Homebrew ${v.bin} likely wins PATH (e.g. fnm/nvm). Remove it or\n` +
        `  reinstall the pinned version via the racked installer:\n` +
        `    node scripts/fleet/setup/setup-tools.mjs`,
    )
  }
  return unresolved
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const fix = process.argv.includes('--fix')
  const violations = findBelowFloor(pathToolPins(REPO_ROOT), pathToolVersion)
  if (violations.length === 0) {
    if (!quiet) {
      logger.success(
        '[path-tools-are-at-pinned-version] every PATH tool meets its pinned floor.',
      )
    }
    return
  }
  if (fix) {
    process.exitCode = runBrewFix(violations) === 0 ? 0 : 1
    return
  }
  const lines = [
    '[path-tools-are-at-pinned-version] a PATH tool is BELOW its pinned floor:',
    '',
  ]
  for (let i = 0, { length } = violations; i < length; i += 1) {
    const v = violations[i]!
    lines.push(
      `  • ${v.bin}: on PATH is ${v.found}, floor is ${v.floor} (${v.source})`,
    )
  }
  lines.push(
    '',
    '  A stray older binary won PATH resolution. A sub-engines.pnpm pnpm makes',
    '  the cascade churn the catalog against an un-refreshable lockfile; a',
    '  sub-pin uv resolves outside the soak-locked closure.',
    '',
    '  Fix: install the pinned version via the fleet racked installer so it',
    '  wins PATH resolution, e.g. node scripts/fleet/setup/setup-tools.mjs',
    '  (or remove the stray Homebrew/corepack binary from PATH).',
  )
  logger.fail(lines.join('\n'))
  process.exitCode = 1
}

if (isMainModule(import.meta.url)) {
  main()
}
