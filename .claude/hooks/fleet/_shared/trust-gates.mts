/**
 * @file Shared trust-gate floor constants + the npm-`.npmrc` `min-release-age`
 *   detector. The pnpm-side trust gates (`trustPolicy`, `minimumReleaseAge`,
 *   `blockExoticSubdeps`) are already enforced by `trust-downgrade-guard`; this
 *   module owns the floor numbers (so the hook, the npm-key check, and the
 *   commit-time `trust-gates-are-not-weakened.mts` check all agree) plus the
 *   npm `.npmrc` `min-release-age` reader that `trust-downgrade-guard` did not
 *   cover.
 *   Pure: no file or process access. Callers pass text and get values back.
 */

/**
 * Minutes. pnpm `minimumReleaseAge` floor — 7 days.
 */
export const MIN_RELEASE_AGE_MINUTES = 10_080

/**
 * Days. npm `.npmrc` `min-release-age` floor — 7 days.
 */
export const MIN_RELEASE_AGE_DAYS = 7

/**
 * Read the npm `min-release-age` value (in days) from a `.npmrc` text, or
 * undefined when the key is absent. `.npmrc` is `key=value`, one per line, with
 * `#` / `;` comments. A non-numeric value yields undefined (treated as absent —
 * fail-open, since a malformed line is not a deliberate downgrade we can
 * score).
 */
export function readNpmrcMinReleaseAge(npmrcText: string): number | undefined {
  const lines = npmrcText.split(/\r?\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const trimmed = lines[i]!.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
      continue
    }
    const eq = trimmed.indexOf('=')
    if (eq <= 0) {
      continue
    }
    if (trimmed.slice(0, eq).trim() !== 'min-release-age') {
      continue
    }
    const n = Number(trimmed.slice(eq + 1).trim())
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

/**
 * Given a `.npmrc` BEFORE/AFTER pair, return a downgrade label when the edit
 * lowers `min-release-age` below the prior value or below the day floor, or
 * removes the key when it was present. undefined when unchanged / strengthened
 * / never present.
 */
export function detectNpmrcMinReleaseAgeDowngrade(
  beforeText: string,
  afterText: string,
): string | undefined {
  const before = readNpmrcMinReleaseAge(beforeText)
  const after = readNpmrcMinReleaseAge(afterText)
  if (before !== undefined && after === undefined) {
    return `.npmrc min-release-age (was ${before}) removed — npm soak disabled`
  }
  if (after === undefined) {
    return undefined
  }
  const lowerThanBefore = before !== undefined && after < before
  const belowFloor = after < MIN_RELEASE_AGE_DAYS
  if (lowerThanBefore || belowFloor) {
    return `.npmrc min-release-age lowered to ${after} (floor is ${MIN_RELEASE_AGE_DAYS} days)`
  }
  return undefined
}

export interface GateFloorViolation {
  /**
   * Which file the gate lives in.
   */
  readonly file: 'pnpm-workspace.yaml' | '.npmrc'
  /**
   * Stable gate identifier.
   */
  readonly gate:
    | 'minimumReleaseAge'
    | 'min-release-age'
    | 'trustPolicy'
    | 'blockExoticSubdeps'
  /**
   * What the file currently has (a number, a value, or `absent`).
   */
  readonly saw: string
  /**
   * What the floor requires.
   */
  readonly wanted: string
}

const TRUST_POLICY_RE = /^trustPolicy\s*:\s*(?<value>\S+)/m
const BLOCK_EXOTIC_RE = /^blockExoticSubdeps\s*:\s*(?<value>\S+)/m
const MIN_RELEASE_AGE_YAML_RE = /^minimumReleaseAge\s*:\s*(?<value>\d+)/m

/**
 * Whole-file floor check for a repo's policy files (no BEFORE — this is the
 * "must be at least this strong" invariant, independent of any single edit).
 * The commit-time `trust-gates-are-not-weakened.mts` check calls this with the
 * on-disk text. pnpm-workspace.yaml is REQUIRED to carry all three pnpm gates;
 * `.npmrc` `min-release-age` is optional (the pnpm gate is primary) but, when
 * present, must meet the day floor.
 */
export function checkGateFloors(
  pnpmWorkspaceText: string | undefined,
  npmrcText: string | undefined,
): GateFloorViolation[] {
  const out: GateFloorViolation[] = []
  if (pnpmWorkspaceText !== undefined) {
    const mraMatch = MIN_RELEASE_AGE_YAML_RE.exec(pnpmWorkspaceText)
    const mra = mraMatch ? Number(mraMatch.groups!['value']) : undefined
    if (mra === undefined) {
      out.push({
        file: 'pnpm-workspace.yaml',
        gate: 'minimumReleaseAge',
        saw: 'absent',
        wanted: `>= ${MIN_RELEASE_AGE_MINUTES}`,
      })
    } else if (mra < MIN_RELEASE_AGE_MINUTES) {
      out.push({
        file: 'pnpm-workspace.yaml',
        gate: 'minimumReleaseAge',
        saw: String(mra),
        wanted: `>= ${MIN_RELEASE_AGE_MINUTES}`,
      })
    }
    const tp = TRUST_POLICY_RE.exec(pnpmWorkspaceText)?.groups?.['value']
    if (tp !== 'no-downgrade') {
      out.push({
        file: 'pnpm-workspace.yaml',
        gate: 'trustPolicy',
        saw: tp ?? 'absent',
        wanted: 'no-downgrade',
      })
    }
    const bes = BLOCK_EXOTIC_RE.exec(pnpmWorkspaceText)?.groups?.['value']
    if (bes !== 'true') {
      out.push({
        file: 'pnpm-workspace.yaml',
        gate: 'blockExoticSubdeps',
        saw: bes ?? 'absent',
        wanted: 'true',
      })
    }
  }
  if (npmrcText !== undefined) {
    const npm = readNpmrcMinReleaseAge(npmrcText)
    if (npm !== undefined && npm < MIN_RELEASE_AGE_DAYS) {
      out.push({
        file: '.npmrc',
        gate: 'min-release-age',
        saw: String(npm),
        wanted: `>= ${MIN_RELEASE_AGE_DAYS}`,
      })
    }
  }
  return out
}
