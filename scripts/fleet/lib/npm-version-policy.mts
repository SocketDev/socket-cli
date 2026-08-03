/*
 * @file The fleet's ONE answer to "which published version may a pin move to?".
 *   Every automation that advances an npm pin — the sync-scaffolding catalog
 *   fixer, the catalog-drift bump, any future planner — routes its choice
 *   through `chooseNpmUpgradeCandidate` so the policy lives in one tested,
 *   pure function instead of being re-derived per caller.
 *   The policy, in order of authority:
 *
 *   1. The registry's `latest` dist-tag is the publisher's own statement of what
 *      is current. Max-semver sorting is an INFERENCE, and the two disagree
 *      exactly when it matters: nock's version list ends `…15.0.0-beta.14,
 *      15.0.0` while `latest` is `14.0.17`, because 15.0.0 was published by
 *      accident. Prefer `latest`; never adopt a version that sorts above it.
 *   2. A version npm marks `deprecated` is never a candidate, however it sorts.
 *      The skip is reported with the upstream's own message so an operator
 *      reads "skipped 15.0.0 — deprecated: released accidentally…" rather than
 *      wondering why the pin stood still.
 *   3. A prerelease (`-alpha`/`-beta`/`-rc`/`-next`/`-canary`/anything after the
 *      `-`) is a candidate only when the CURRENT pin is itself a prerelease on
 *      that same major line — moving along a line you already opted into is
 *      legitimate; jumping onto one is not.
 *   4. The fleet soak window applies last: a third-party release must have been
 *      published `soakDays` ago (fail-closed — an undatable version is treated
 *      as still soaking). `soakExempt` covers the Socket-owned scopes that ride
 *      the `minimumReleaseAgeExclude` globs. `chooseNpmUpgradeCandidate` is
 *      pure: version metadata in, a candidate plus a reason out.
 *      `fetchNpmPackageVersionMetadata` is the networked seam that feeds it,
 *      and it is fail-open by contract — no registry answer yields `undefined`,
 *      which the decision reports as "not verified this run" rather than as
 *      "nothing to do".
 */

import { httpJson } from '@socketsecurity/lib-stable/http-request'
import { compare } from '@socketsecurity/lib-stable/versions/compare'
import { getMajorVersion } from '@socketsecurity/lib-stable/versions/parse'

import { NPM_REGISTRY_URL } from '../constants/npm-registry.mts'
import { SOAK_DAYS } from '../constants/soak.mts'

const DAY_MS = 86_400_000

// Bounded per-attempt timeout so an unreachable or throttled registry cannot
// stall a cascade; two attempts absorb one transient blip, then fail open.
const FETCH_TIMEOUT_MS = 15_000

/**
 * One published version as the policy needs to see it: its number, when npm
 * recorded the publish (ISO `YYYY-MM-DD`), and the upstream's deprecation
 * message when there is one.
 */
export interface NpmVersionRecord {
  readonly deprecated?: string | undefined
  readonly publishedAt?: string | undefined
  readonly version: string
}

/**
 * The registry facts one package contributes to a decision: its `latest`
 * dist-tag and every published version.
 */
export interface NpmPackageVersionMetadata {
  readonly distTagLatest?: string | undefined
  readonly name: string
  readonly versions: readonly NpmVersionRecord[]
}

/**
 * A newer version the policy refused, with the reason an operator needs to
 * see. Never silently dropped — a skip without a reason reads as a bug.
 */
export interface SkippedUpgradeCandidate {
  readonly reason: string
  readonly version: string
}

/**
 * The verdict: the version a pin may move to, which is absent when none
 * qualifies, whether that version is the registry's own `latest`, and the
 * reason for both the choice and every refusal.
 */
export interface NpmUpgradeDecision {
  readonly candidate?: string | undefined
  readonly distTagLatest?: string | undefined
  readonly isDistTagLatest: boolean
  readonly reason: string
  readonly skipped: readonly SkippedUpgradeCandidate[]
  readonly verified: boolean
}

/**
 * Inputs to the pure decision. `today` is the ISO `YYYY-MM-DD` the caller
 * stamped once, so soak math is deterministic and testable.
 */
export interface ChooseNpmUpgradeCandidateConfig {
  readonly currentVersion: string
  readonly metadata?: NpmPackageVersionMetadata | undefined
  readonly soakDays?: number | undefined
  readonly soakExempt?: boolean | undefined
  readonly today: string
}

/**
 * True when `version` carries a prerelease identifier (`1.0.0-beta.1`,
 * `2.0.0-rc.3`, `3.0.0-next.0`). Semver puts every prerelease tag after the
 * first `-`, so one test covers alpha/beta/rc/next/canary and any tag an
 * upstream invents.
 */
export function isPrereleaseVersion(version: string): boolean {
  return version.includes('-')
}

/**
 * True when `publishedDate` (ISO `YYYY-MM-DD`) has soaked long enough that
 * npm's `minimumReleaseAge` gate is GUARANTEED to admit the version. `today`
 * is passed in so the function stays pure. Returns false on an unparseable
 * date — fail-closed: a version we cannot date has not proven its soak.
 *
 * The date carries no time-of-day, but the gate measures from the publish
 * TIMESTAMP, so the publish is anchored at the END of its day (the worst
 * case). Clearing the window a day late is harmless; clearing it an hour
 * early breaks the install.
 */
export function isPastSoak(
  publishedDate: string,
  today: string,
  soakDays: number = SOAK_DAYS,
): boolean {
  const publishedStart = Date.parse(`${publishedDate}T00:00:00Z`)
  const now = Date.parse(`${today}T00:00:00Z`)
  if (Number.isNaN(publishedStart) || Number.isNaN(now)) {
    return false
  }
  const publishedEnd = publishedStart + DAY_MS
  return (now - publishedEnd) / DAY_MS >= soakDays
}

/**
 * The first line of a deprecation message, trimmed — npm messages are free
 * text and some upstreams paste paragraphs; one line is what an operator
 * reads in a check's output.
 */
export function summarizeDeprecation(message: string): string {
  return message.split('\n')[0]!.trim()
}

/**
 * Sort versions oldest → newest. `compare` returns `undefined` for a version
 * it cannot parse; those sort first and never win the `.at(-1)` pick.
 */
function byAscendingVersion(a: string, b: string): number {
  return compare(a, b) ?? 0
}

/**
 * Decide the version a pin at `currentVersion` may move to. Pure — the whole
 * policy in one function, the primary unit-test target.
 *
 * When `metadata` is absent because the registry did not answer this run,
 * the result is `verified: false` with no candidate: the caller must report
 * "not checked", never "up to date". Present metadata always yields
 * `verified: true`, even when nothing qualifies.
 */
export function chooseNpmUpgradeCandidate(
  config: ChooseNpmUpgradeCandidateConfig,
): NpmUpgradeDecision {
  const {
    currentVersion,
    metadata,
    soakDays = SOAK_DAYS,
    soakExempt = false,
    today,
  } = { __proto__: null, ...config } as ChooseNpmUpgradeCandidateConfig
  if (!metadata) {
    return {
      candidate: undefined,
      distTagLatest: undefined,
      isDistTagLatest: false,
      reason:
        'the registry did not answer this run, so the pin was NOT checked for updates',
      skipped: [],
      verified: false,
    }
  }
  const { distTagLatest } = metadata
  const currentIsPrerelease = isPrereleaseVersion(currentVersion)
  const currentMajor = getMajorVersion(currentVersion)
  // The `latest` ceiling binds a pin that sits at or below `latest`. A pin
  // already ABOVE it — a prerelease line the repo deliberately tracks, or a
  // version a publisher later unpublished from `latest` — is not dragged back
  // down by it, so moving forward along that line stays possible.
  const latestCeiling =
    distTagLatest && byAscendingVersion(currentVersion, distTagLatest) <= 0
      ? distTagLatest
      : undefined
  const eligible: string[] = []
  const skipped: SkippedUpgradeCandidate[] = []
  const { versions } = metadata
  for (let i = 0, { length } = versions; i < length; i += 1) {
    const record = versions[i]!
    const { version } = record
    if (byAscendingVersion(version, currentVersion) <= 0) {
      continue
    }
    if (record.deprecated) {
      skipped.push({
        reason: `deprecated: ${summarizeDeprecation(record.deprecated)}`,
        version,
      })
      continue
    }
    if (
      isPrereleaseVersion(version) &&
      !(currentIsPrerelease && getMajorVersion(version) === currentMajor)
    ) {
      skipped.push({
        reason: `prerelease — the pin ${currentVersion} does not track that prerelease line`,
        version,
      })
      continue
    }
    if (latestCeiling && byAscendingVersion(version, latestCeiling) > 0) {
      skipped.push({
        reason: `sorts above the registry \`latest\` dist-tag ${latestCeiling}, the publisher's own statement of what is current`,
        version,
      })
      continue
    }
    if (!soakExempt) {
      const { publishedAt } = record
      if (!publishedAt) {
        skipped.push({
          reason:
            'the registry carries no publish date for it, so its soak cannot be proven cleared',
          version,
        })
        continue
      }
      if (!isPastSoak(publishedAt, today, soakDays)) {
        skipped.push({
          reason: `published ${publishedAt}, still inside the ${soakDays}-day soak`,
          version,
        })
        continue
      }
    }
    eligible.push(version)
  }
  if (distTagLatest && eligible.includes(distTagLatest)) {
    return {
      candidate: distTagLatest,
      distTagLatest,
      isDistTagLatest: true,
      reason: `the registry \`latest\` dist-tag ${distTagLatest} is adoptable`,
      skipped,
      verified: true,
    }
  }
  const highest = eligible.toSorted(byAscendingVersion).at(-1)
  if (highest) {
    return {
      candidate: highest,
      distTagLatest,
      isDistTagLatest: false,
      reason: distTagLatest
        ? `\`latest\` (${distTagLatest}) is not adoptable yet, so ${highest} is the newest adoptable release at or below it`
        : `${highest} is the newest adoptable release`,
      skipped,
      verified: true,
    }
  }
  return {
    candidate: undefined,
    distTagLatest,
    isDistTagLatest: false,
    reason: skipped.length
      ? `nothing newer than ${currentVersion} is adoptable; ${skipped.length} newer version(s) were skipped`
      : `${currentVersion} is already the newest published version`,
    skipped,
    verified: true,
  }
}

/**
 * The subset of an npm packument this policy reads. Declared narrowly so the
 * registry's much wider document shape never leaks into the decision.
 */
export interface RawNpmPackument {
  readonly 'dist-tags'?: Record<string, unknown> | undefined
  readonly name?: string | undefined
  readonly time?: Record<string, unknown> | undefined
  readonly versions?:
    | Record<string, { deprecated?: unknown | undefined } | undefined>
    | undefined
}

/**
 * Normalize a raw packument into the facts `chooseNpmUpgradeCandidate` needs.
 * Pure, so the parse is testable against a canned document. Versions come
 * from the `versions` map (the `time` map also holds `created`/`modified`
 * bookkeeping keys and unpublished versions); the publish date and the
 * deprecation message are attached per version when the registry carries
 * them.
 */
export function parseNpmPackument(
  packageName: string,
  raw: RawNpmPackument | undefined,
): NpmPackageVersionMetadata | undefined {
  const rawVersions = raw?.versions
  if (!rawVersions) {
    return undefined
  }
  const time = raw?.time ?? {}
  const versions: NpmVersionRecord[] = []
  const versionKeys = Object.keys(rawVersions)
  for (let i = 0, { length } = versionKeys; i < length; i += 1) {
    const version = versionKeys[i]!
    const deprecated = rawVersions[version]?.deprecated
    const stamp = time[version]
    versions.push({
      ...(typeof deprecated === 'string' && deprecated !== ''
        ? { deprecated }
        : {}),
      ...(typeof stamp === 'string' ? { publishedAt: stamp.slice(0, 10) } : {}),
      version,
    })
  }
  const latest = raw?.['dist-tags']?.['latest']
  return {
    ...(typeof latest === 'string' && latest !== ''
      ? { distTagLatest: latest }
      : {}),
    name: raw?.name ?? packageName,
    versions,
  }
}

/**
 * Read one package's version metadata from the canonical registry. FAIL-OPEN
 * by contract: a timeout, an offline machine, a 4xx/5xx, or an unparseable
 * body all yield `undefined`, which the decision surfaces as "not verified
 * this run" — never as a silent green, and never as a hard failure that reds
 * a cascade on connectivity alone.
 */
export async function fetchNpmPackageVersionMetadata(
  packageName: string,
): Promise<NpmPackageVersionMetadata | undefined> {
  const url = `${NPM_REGISTRY_URL}/${encodeURIComponent(packageName).replaceAll('%40', '@')}`
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const raw = await httpJson<RawNpmPackument>(url, {
        headers: { accept: 'application/json' },
        timeout: FETCH_TIMEOUT_MS,
      })
      return parseNpmPackument(packageName, raw)
    } catch {
      // Transient (timeout / network) — retry once, then give up fail-open.
    }
  }
  return undefined
}
