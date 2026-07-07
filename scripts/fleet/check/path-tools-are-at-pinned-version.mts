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
// Usage: node scripts/fleet/check/path-tools-are-at-pinned-version.mts [--quiet]

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
// oxlint-disable-next-line socket/prefer-async-spawn -- a sync --version probe in a check; no streaming, just exit status + trimmed stdout.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
// oxlint-disable-next-line socket/prefer-stable-external-semver -- @socketsecurity/lib-stable doesn't export ./external/semver at the pinned version; bare semver is a devDependency here (a check script, not bundled into a runtime artifact).
import { coerce, lt, minVersion } from 'semver'

import { REPO_ROOT } from '../paths.mts'

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
  try {
    const min = minVersion(pin)
    if (min) {
      return min.version
    }
  } catch {
    // Not a range — fall through to coerce.
  }
  return coerce(pin)?.version
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
  return coerce(out)?.version
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

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const violations = findBelowFloor(pathToolPins(REPO_ROOT), pathToolVersion)
  if (violations.length === 0) {
    if (!quiet) {
      logger.success(
        '[path-tools-are-at-pinned-version] every PATH tool meets its pinned floor.',
      )
    }
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

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main()
}
