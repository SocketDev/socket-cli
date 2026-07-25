#!/usr/bin/env node
/*
 * @file Resolve the EXACT version a Dependabot security fix should pin to —
 *   the deterministic "highest soaked release within first_patched's major"
 *   math the updating-security skill drives, leaving the cross-major benignity
 *   judgment + the dismissal/override prose to the model.
 *
 *   The fleet pins exact versions everywhere (`uuid: 11.1.1`, never `^11.1.1`):
 *   a range lets a non-frozen `pnpm install` slide to an un-soaked release,
 *   defeating both determinism and the 7-day malware soak. The resolution rule
 *   (reference.md "Pin target"):
 *
 *     1. Take `first_patched_version`; note its major.
 *     2. Keep only STABLE releases >= first_patched in that major that have
 *        cleared the 7-day soak (publish date >= 7 days ago).
 *     3. Pin to the HIGHEST survivor. Usually first_patched itself; higher only
 *        when a newer in-major patch has since soaked.
 *     4. No in-major soaked survivor -> the resolver returns no pin + a reason
 *        (`awaiting-soak` when an in-major fix is still soaking, `cross-major`
 *        when the fix shipped only in a higher major). The skill runs the AI
 *        benignity check on cross-major and the soak gate on awaiting-soak —
 *        those are judgment, not math, so they stay in the skill.
 *
 *   Pre-releases (`-rc`/`-beta`/`-alpha`/`-next`/`-canary`) are NEVER pin
 *   targets — a security pin lands on a stable line only. Semver is done with
 *   socket-lib's `versions/*` helpers (never hand-rolled regex / `sort -V` —
 *   off-by-one on pre-release / build metadata is the classic bug).
 *
 *   The version list + publish dates are supplied by the caller (the skill runs
 *   `npm view <pkg> versions --json` + `npm view <pkg> time --json`), so the
 *   core is pure + deterministic + testable with no network. The CLI also
 *   accepts a `--versions-file` of `{ versions: string[], time: {ver: iso} }`
 *   (the shape `npm view <pkg> time --json` returns) for one-shot use.
 */

import { readFileSync } from 'node:fs'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { getMajorVersion } from '@socketsecurity/lib-stable/versions/parse'
import {
  filterVersions,
  maxVersion,
} from '@socketsecurity/lib-stable/versions/range'
import { isMainModule } from './_shared/is-main-module.mts'

const logger = getDefaultLogger()

// The 7-day malware soak (CLAUDE.md _Tooling_ § minimumReleaseAge). A patched
// version younger than this is not yet a pin target — the skill records it as
// awaiting-soak (the soak guard is never bypassed without explicit signoff).
export const SOAK_DAYS = 7

const MS_PER_DAY = 86_400_000

export type ResolveOutcome =
  | 'awaiting-soak'
  | 'cross-major'
  | 'no-candidate'
  | 'resolved'

export interface ResolveSecurityPinConfig {
  // first_patched_version from the advisory (the lowest version that clears the
  // CVE for our vulnerable range).
  firstPatched: string
  // Every published version of the package (e.g. `npm view <pkg> versions`).
  publishedVersions: readonly string[]
  // The current instant, in epoch ms. Injectable so tests are deterministic.
  now: number
  // Per-version publish instants in epoch ms, keyed by version. A version
  // absent from the map is treated as un-soaked (no known publish date ->
  // cannot prove it cleared the soak).
  publishedAt: Readonly<Record<string, number>>
}

export interface ResolveSecurityPinResult {
  outcome: ResolveOutcome
  // The exact version to pin to, or undefined when outcome !== 'resolved'.
  pinTarget: string | undefined
  // Human-readable explanation of the outcome (for the skill's report line).
  reason: string
}

// Has `version` cleared the 7-day soak as of `now`? A version with no known
// publish date is treated as NOT soaked — we cannot prove its age, and a
// security pin must never land on an un-provable release.
export function isSoaked(
  version: string,
  config: { now: number; publishedAt: Readonly<Record<string, number>> },
): boolean {
  const cfg = { __proto__: null, ...config } as {
    now: number
    publishedAt: Readonly<Record<string, number>>
  }
  const published = cfg.publishedAt[version]
  if (published === undefined) {
    return false
  }
  return cfg.now - published >= SOAK_DAYS * MS_PER_DAY
}

// The deterministic core. Given the advisory's first_patched, the published
// version list, and per-version publish dates, resolve the exact pin (or the
// reason there is none). Pure — no network, no clock; the caller injects `now`.
export function resolveSecurityPin(
  config: ResolveSecurityPinConfig,
): ResolveSecurityPinResult {
  const cfg = { __proto__: null, ...config } as ResolveSecurityPinConfig
  const { firstPatched, now, publishedAt, publishedVersions } = cfg
  const major = getMajorVersion(firstPatched)
  if (major === undefined) {
    return {
      outcome: 'no-candidate',
      pinTarget: undefined,
      reason: `could not parse a major version from first_patched \`${firstPatched}\``,
    }
  }
  // filterVersions drops pre-releases by default, so a pin can never land on an
  // `-rc` / `-beta`. The `<${major + 1}.0.0` upper bound keeps the pin in-major
  // (crossing a major is the separate gated path the skill owns).
  const inMajorRange = `>=${firstPatched} <${major + 1}.0.0`
  const inMajor = filterVersions([...publishedVersions], inMajorRange)
  const inMajorSoaked = inMajor.filter(v => isSoaked(v, { now, publishedAt }))
  const inMajorPin = maxVersion(inMajorSoaked)
  if (inMajorPin) {
    return {
      outcome: 'resolved',
      pinTarget: inMajorPin,
      reason: `highest soaked release in major ${major} (>=${firstPatched})`,
    }
  }
  // An in-major fix EXISTS but none has soaked yet -> awaiting-soak (the skill
  // honors the soak guard; do not bypass).
  if (inMajor.length) {
    return {
      outcome: 'awaiting-soak',
      pinTarget: undefined,
      reason: `in-major fix(es) ${inMajor.join(', ')} still inside the ${SOAK_DAYS}-day soak`,
    }
  }
  // No in-major patched release at all -> the fix shipped only in a higher
  // major. The major bump IS the path, but it needs the AI benignity check the
  // skill runs; the resolver surfaces the highest soaked cross-major candidate.
  const crossMajor = filterVersions([...publishedVersions], `>=${firstPatched}`)
  const crossMajorSoaked = crossMajor.filter(v =>
    isSoaked(v, { now, publishedAt }),
  )
  const crossPin = maxVersion(crossMajorSoaked)
  if (crossPin) {
    return {
      outcome: 'cross-major',
      pinTarget: crossPin,
      reason: `no in-major fix; highest soaked cross-major candidate is ${crossPin} (needs AI benignity check before crossing major ${major})`,
    }
  }
  return {
    outcome: 'no-candidate',
    pinTarget: undefined,
    reason: `no stable, soaked release >= ${firstPatched} found in the published set`,
  }
}

interface VersionsFile {
  time?: Record<string, string> | undefined
  versions?: string[] | undefined
}

// Parse `npm view <pkg> time --json` shape into the published-version list +
// per-version epoch-ms map. `time` carries `created`/`modified` meta keys that
// are not versions — drop any key that has no entry in `versions` when that
// list is present; otherwise treat every non-meta key as a version.
function readVersionsFile(filePath: string): {
  publishedAt: Record<string, number>
  publishedVersions: string[]
} {
  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as VersionsFile
  const time = parsed.time ?? {}
  const metaKeys = new Set(['created', 'modified'])
  const versions =
    parsed.versions ?? Object.keys(time).filter(k => !metaKeys.has(k))
  const publishedAt: Record<string, number> = {
    __proto__: null,
  } as unknown as Record<string, number>
  for (let i = 0, { length } = versions; i < length; i += 1) {
    const v = versions[i]!
    const iso = time[v]
    if (iso !== undefined) {
      publishedAt[v] = Date.parse(iso)
    }
  }
  return { publishedAt, publishedVersions: versions }
}

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag)
  return idx !== -1 ? argv[idx + 1] : undefined
}

const USAGE = `resolve-security-pin — resolve the exact version a security fix should pin to

Usage:
  resolve-security-pin.mts --first-patched <ver> --versions-file <time.json> [--now <iso>]

  --first-patched   first_patched_version from the Dependabot advisory.
  --versions-file   JSON of \`npm view <pkg> time --json\` (or \`{ versions, time }\`).
  --now             override "now" (ISO 8601) for deterministic resolution.

Prints { outcome, pinTarget, reason }. Exit 0 when resolved, 1 otherwise.
`

export function main(argv: readonly string[]): number {
  const firstPatched = flagValue(argv, '--first-patched')
  const versionsFile = flagValue(argv, '--versions-file')
  if (!firstPatched || !versionsFile) {
    process.stderr.write(USAGE)
    return 1
  }
  const nowArg = flagValue(argv, '--now')
  const now = nowArg ? Date.parse(nowArg) : Date.now()
  const { publishedAt, publishedVersions } = readVersionsFile(versionsFile)
  const result = resolveSecurityPin({
    firstPatched,
    now,
    publishedAt,
    publishedVersions,
  })
  process.stdout.write(`${JSON.stringify(result, undefined, 2)}\n`)
  return result.outcome === 'resolved' ? 0 : 1
}

if (isMainModule(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (e) {
    logger.fail(`resolve-security-pin: ${errorMessage(e)}`)
    process.exitCode = 1
  }
}
