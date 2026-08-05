/*
 * @file Decide HOW a duplicated dependency family collapses: a RANGE
 *   consolidation every declared constraint already admits, or an `overrides:`
 *   entry that forces a version past those constraints.
 *
 *   The difference is a safety one. An override forces its value on every
 *   consumer regardless of what that consumer declared, so it earns the whole
 *   deduping-dependencies analysis: format flip, API break, consumer grep. A
 *   range consolidation picks a version every consumer's own range already
 *   accepts, so it is safe by construction and earns none of that. Reaching for
 *   the override first pays the analysis cost on families that never needed it.
 *
 *   The verdicts:
 *
 *   - `inconclusive` — a consumer's range could not be read. An unreadable
 *     manifest is blindness, never "no constraint", so nothing is claimed and
 *     the unreadable consumers land in `blockedBy`.
 *   - `range-consolidable` — the highest already-resolved version that satisfies
 *     every declared range. No override needed, no analysis needed.
 *   - `range-by-bump` — no resolved version satisfies everyone, yet a published
 *     one does, so the collapse lands by bumping to that version. Offered only
 *     when the caller supplies `publishedVersions`.
 *   - `needs-override` — no single version satisfies every range. `target`
 *     carries the version that leaves the fewest consumers behind, and
 *     `blockedBy` names every consumer whose range excludes it.
 *
 *   `retirableOverride` marks the case worth grepping for first: a family that
 *   already carries an override yet judges `range-consolidable`, an override
 *   that never needed to exist.
 *
 *   Range semantics are per-ecosystem: Cargo, PEP 440, Maven's bracket
 *   intervals, and RubyGems' pessimistic operator each read a range on their own
 *   terms, so the `satisfies` and `compare` fields on the input are the seam
 *   that carries them, and each ecosystem adapter supplies its own pair.
 *
 *   Pure. Every input is passed in, so there is no lockfile read, no registry
 *   call, and no clock. With no seam supplied the defaults are
 *   `satisfiesSemverRange` and `compareSemverVersions`, both socket-lib backed,
 *   which read an unparsable range or version as unsatisfied and unorderable
 *   rather than throwing.
 */

import { compare as compareLibVersions } from '@socketsecurity/lib-stable/versions/compare'
import { satisfiesVersion } from '@socketsecurity/lib-stable/versions/range'

export interface ConsumerConstraint {
  readonly consumer: string
  readonly range: string | undefined
}

export interface FamilyInput {
  readonly name: string
  readonly resolvedVersions: readonly string[]
  readonly consumers: readonly ConsumerConstraint[]
  readonly publishedVersions?: readonly string[] | undefined
  readonly hasOverride: boolean
  // Does this version admit that declared range? Defaults to
  // `satisfiesSemverRange`.
  readonly satisfies?: ((version: string, range: string) => boolean) | undefined
  // Orders two versions so "highest satisfying" is well defined without semver.
  // Defaults to `compareSemverVersions`.
  readonly compare?: ((a: string, b: string) => number) | undefined
}

export type ConsolidationVerdict =
  | 'inconclusive'
  | 'needs-override'
  | 'range-by-bump'
  | 'range-consolidable'

export interface FamilyVerdict {
  readonly name: string
  readonly verdict: ConsolidationVerdict
  readonly target: string | undefined
  readonly blockedBy: readonly ConsumerConstraint[]
  readonly retirableOverride: boolean
}

/**
 * The default range check for the `satisfies` seam: semver, socket-lib backed.
 * An unparsable range or version reads as unsatisfied rather than throwing.
 */
export function satisfiesSemverRange(version: string, range: string): boolean {
  return satisfiesVersion(version, range)
}

/**
 * The default ordering for the `compare` seam: semver, socket-lib backed. A
 * pair socket-lib cannot parse yields `NaN`, which `highestVersion` reads as
 * unorderable.
 */
export function compareSemverVersions(a: string, b: string): number {
  const order = compareLibVersions(a, b)
  return order === undefined ? Number.NaN : order
}

/**
 * The highest version `compareVersions` can place. A version that does not
 * order against itself is unorderable, so it drops out of the running instead
 * of throwing, and an unparsable entry can never become the target.
 */
export function highestVersion(
  versions: readonly string[],
  compareVersions: (a: string, b: string) => number,
): string | undefined {
  let highest: string | undefined
  for (let i = 0, { length } = versions; i < length; i += 1) {
    const version = versions[i]!
    if (Number.isNaN(compareVersions(version, version))) {
      continue
    }
    if (highest === undefined || compareVersions(version, highest) > 0) {
      highest = version
    }
  }
  return highest
}

export function judgeFamily(input: FamilyInput): FamilyVerdict {
  const {
    compare = compareSemverVersions,
    consumers,
    hasOverride,
    name,
    publishedVersions,
    resolvedVersions,
    satisfies = satisfiesSemverRange,
  } = input
  const blind: ConsumerConstraint[] = []
  const declared: Array<{ consumer: ConsumerConstraint; range: string }> = []
  for (let i = 0, { length } = consumers; i < length; i += 1) {
    const consumer = consumers[i]!
    const { range } = consumer
    if (range === undefined) {
      blind.push(consumer)
    } else {
      declared.push({ consumer, range })
    }
  }
  // One unreadable range poisons the whole family: a version that satisfies
  // every range we could read may still break the one we could not.
  if (blind.length > 0) {
    return {
      blockedBy: blind,
      name,
      retirableOverride: false,
      target: undefined,
      verdict: 'inconclusive',
    }
  }
  // Nothing to collapse. The family already resolves to one version, so that
  // version is the target and no range can object to what it already got.
  if (resolvedVersions.length <= 1) {
    return {
      blockedBy: [],
      name,
      retirableOverride: hasOverride,
      target: resolvedVersions[0],
      verdict: 'range-consolidable',
    }
  }
  const fitCount = (version: string) =>
    declared.filter(entry => satisfies(version, entry.range)).length
  const fitsEveryRange = (version: string) =>
    fitCount(version) === declared.length
  const resolvedTarget = highestVersion(
    resolvedVersions.filter(fitsEveryRange),
    compare,
  )
  if (resolvedTarget !== undefined) {
    return {
      blockedBy: [],
      name,
      retirableOverride: hasOverride,
      target: resolvedTarget,
      verdict: 'range-consolidable',
    }
  }
  if (publishedVersions !== undefined) {
    const bumpTarget = highestVersion(
      publishedVersions.filter(fitsEveryRange),
      compare,
    )
    if (bumpTarget !== undefined) {
      return {
        blockedBy: [],
        name,
        retirableOverride: false,
        target: bumpTarget,
        verdict: 'range-by-bump',
      }
    }
  }
  // No version satisfies everyone, so the override has to force one. Force the
  // one the fewest consumers object to, highest wins a tie.
  let bestFitCount = 0
  for (let i = 0, { length } = resolvedVersions; i < length; i += 1) {
    const fits = fitCount(resolvedVersions[i]!)
    if (fits > bestFitCount) {
      bestFitCount = fits
    }
  }
  const target = highestVersion(
    resolvedVersions.filter(version => fitCount(version) === bestFitCount),
    compare,
  )
  const blockedBy =
    target === undefined
      ? consumers
      : declared
          .filter(entry => !satisfies(target, entry.range))
          .map(entry => entry.consumer)
  return {
    blockedBy,
    name,
    retirableOverride: false,
    target,
    verdict: 'needs-override',
  }
}

export function judgeFamilies(
  inputs: readonly FamilyInput[],
): readonly FamilyVerdict[] {
  return inputs.map(input => judgeFamily(input))
}
