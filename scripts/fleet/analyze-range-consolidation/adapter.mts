/*
 * @file The ecosystem seam for the range-consolidation analyzer, plus the
 *   CANDIDATE the analyzer hands a human. `verdict.mts` decides how a duplicated
 *   family collapses; an adapter's whole job is to produce the family inputs
 *   that decision needs, out of whatever the ecosystem's resolver actually
 *   wrote. Nothing about a lockfile shape, a dep-path grammar, or a virtual
 *   store crosses this boundary — an adapter hands back names, versions,
 *   declared ranges, and where it read each one.
 *
 *   An adapter answers three things:
 *
 *   - `purlType` — which ecosystem it speaks for, keyed on the PURL type Socket
 *     already keys everything on (`pkg:npm`, `pkg:cargo`, …) so there is no
 *     parallel enum to drift.
 *   - `detect` — whether the repo uses this ecosystem at all. Absent means
 *     not-applicable, which is a normal answer and not a failure.
 *   - `readFamilies` — the duplicated families with every consumer's DECLARED
 *     range, or a loud failure. It returns a RESULT rather than the plan's bare
 *     array because an unreadable lockfile has to stay distinguishable from a
 *     clean tree: flattening it to zero families is the false-green the fleet's
 *     blindness-is-not-absence rule exists to forbid.
 *
 *   `notApplicableReason` is how an ecosystem that structurally cannot be
 *   analyzed says so. Go is the case that forces it: `go.mod` declares a
 *   MINIMUM, not a range, and Minimal Version Selection picks exactly one
 *   version per major path, so there is nothing to intersect. That is an
 *   explicit answer, never a silent skip.
 *
 *   A CANDIDATE is a verdict plus the evidence for it. Three statuses, and the
 *   line between them is what can be MEASURED rather than predicted:
 *
 *   - `consolidatable` — one already-resolved version satisfies every declared
 *     range, each check run through the ecosystem's own `satisfies` seam. Safe
 *     by construction, so no override and no safety analysis.
 *   - `consolidatable-by-widening` — one version satisfies every range once the
 *     named ranges are widened, every widening lands on a consumer the repo
 *     OWNS, and each proposed range was measured to admit both the collapse
 *     target and the version that consumer resolves to today.
 *   - `unproven` — anything else, always with the reason. A consumer whose range
 *     could not be read, a blocking range that belongs to a published package
 *     the repo cannot edit, a collapse that needs a version nobody installed. A
 *     confident wrong answer here is worse than no answer, because the fleet
 *     rule is that an override's value is measured and never predicted.
 */

import type { OverrideAuditRead } from './override-audit.mts'
import { judgeFamily, satisfiesSemverRange } from './verdict.mts'
import type {
  ConsolidationVerdict,
  ConsumerConstraint,
  FamilyInput,
} from './verdict.mts'

// Who states a declared range, which decides whether the repo can widen it. An
// `importer` is a workspace manifest the repo owns and can edit; a `package` is
// a published dependency, whose range moves only via `pnpm patch` or an
// `overrides:` entry.
export type ConsumerKind = 'importer' | 'package'

export interface ConsumerEvidence {
  // Matches the `consumer` on the `ConsumerConstraint` handed to `verdict.mts`,
  // so a blocker names its own evidence row.
  readonly consumer: string
  readonly consumerKind: ConsumerKind
  readonly declaredRange: string | undefined
  // Where the range was read — a lockfile field path or a manifest file path.
  readonly rangeSource: string
  readonly resolvedVersion: string
  // Why the range could not be read, when it could not.
  readonly unreadableReason: string | undefined
}

export interface FamilyEvidence {
  readonly consumers: readonly ConsumerEvidence[]
  readonly name: string
  readonly resolvedVersions: readonly string[]
}

// One family as an adapter read it: what `verdict.mts` judges, paired with the
// receipts for every number in it.
export interface FamilyReading {
  readonly evidence: FamilyEvidence
  readonly input: FamilyInput
}

export interface EcosystemProbe {
  readonly repoRoot: string
}

export interface EcosystemFamilyReadFailure {
  readonly ok: false
  // What the adapter could not read, in What / Where / Saw-vs-wanted / Fix
  // order, ready to surface verbatim.
  readonly reason: string
}

export interface EcosystemFamilyReadSuccess {
  readonly ok: true
  readonly readings: readonly FamilyReading[]
}

export type EcosystemFamilyRead =
  | EcosystemFamilyReadFailure
  | EcosystemFamilyReadSuccess

export interface EcosystemAdapter {
  readonly purlType: string
  // Does this repo use this ecosystem at all? Absent → not-applicable.
  detect(config: EcosystemProbe): Promise<boolean>
  // The duplicate families, with every consumer's DECLARED range.
  readFamilies(config: EcosystemProbe): Promise<EcosystemFamilyRead>
  // Every override entry this repo carries, classified by what it buys. Absent
  // means this ecosystem has no override audit yet, which the report says out
  // loud rather than printing a zero it never measured.
  auditOverrides?(config: EcosystemProbe): Promise<OverrideAuditRead>
  // Why this ecosystem cannot be analyzed, when it structurally cannot.
  readonly notApplicableReason?: string | undefined
}

export type CandidateStatus =
  | 'consolidatable'
  | 'consolidatable-by-widening'
  | 'unproven'

// One declared range the repo would widen, and what to widen it to. Only ever
// emitted for a range the repo owns, and only after the proposal was measured
// against the ecosystem's `satisfies` seam.
export interface RangeWidening {
  readonly consumer: string
  readonly consumerKind: ConsumerKind
  readonly declaredRange: string
  readonly proposedRange: string
}

export interface ConsolidationCandidate {
  readonly evidence: FamilyEvidence
  readonly purlType: string
  // The family already carries an override yet needs none — an override that
  // never had to exist.
  readonly retirableOverride: boolean
  readonly status: CandidateStatus
  // The single version the family would collapse onto.
  readonly target: string | undefined
  readonly unprovenReason: string | undefined
  readonly verdict: ConsolidationVerdict
  readonly widenings: readonly RangeWidening[]
}

/**
 * The union of a declared range and a collapse target — the one widening shape
 * that provably cannot narrow, since a union only ever admits more. Whether the
 * ecosystem's range grammar actually reads it that way is MEASURED by the
 * caller against `satisfies`, never assumed from the syntax.
 */
export function unionRangeWith(declaredRange: string, target: string): string {
  return `${declaredRange} || ${target}`
}

/**
 * The evidence row a consumer constraint came from, matched on the consumer
 * label the adapter put on both.
 */
export function findConsumerEvidence(
  evidence: FamilyEvidence,
  consumer: string,
): ConsumerEvidence | undefined {
  return evidence.consumers.find(row => row.consumer === consumer)
}

/**
 * Judge one family and attach the evidence, ending in a status that says what
 * was proven rather than what looks likely.
 *
 * The order of the checks is the order of the doubts. An unreadable range beats
 * everything, since nothing can be claimed over a range nobody read. Then a
 * blocking range the repo cannot edit, then a widening the ecosystem's own
 * range grammar refuses. Only a family that survives all three is called
 * collapsible.
 */
export function buildConsolidationCandidate(config: {
  readonly purlType: string
  readonly reading: FamilyReading
}): ConsolidationCandidate {
  const { purlType, reading } = config
  const { evidence, input } = reading
  const satisfies = input.satisfies ?? satisfiesSemverRange
  const judged = judgeFamily(input)
  const base = {
    evidence,
    purlType,
    retirableOverride: judged.retirableOverride,
    target: judged.target,
    verdict: judged.verdict,
  }
  if (judged.verdict === 'range-consolidable') {
    return {
      ...base,
      status: 'consolidatable',
      unprovenReason: undefined,
      widenings: [],
    }
  }
  if (judged.verdict === 'inconclusive') {
    return {
      ...base,
      status: 'unproven',
      unprovenReason: describeUnreadableRanges(evidence, judged.blockedBy),
      widenings: [],
    }
  }
  if (judged.verdict === 'range-by-bump') {
    return {
      ...base,
      status: 'unproven',
      unprovenReason:
        `no installed version satisfies every declared range, and the ` +
        `published version ${judged.target} that would was not installed — ` +
        `proving that collapse needs the version in the tree.`,
      widenings: [],
    }
  }
  const { target } = judged
  if (target === undefined) {
    return {
      ...base,
      status: 'unproven',
      unprovenReason:
        `no resolved version could be ordered against the others, so this ` +
        `family has no collapse target to test a widening against.`,
      widenings: [],
    }
  }
  const unownedBlocker = judged.blockedBy.find(blocker => {
    const row = findConsumerEvidence(evidence, blocker.consumer)
    return row === undefined || row.consumerKind === 'package'
  })
  if (unownedBlocker) {
    return {
      ...base,
      status: 'unproven',
      unprovenReason:
        `${unownedBlocker.consumer} declares ${unownedBlocker.range}, which ` +
        `excludes ${target}, and that range belongs to a published package ` +
        `this repo cannot edit — collapsing it needs a \`pnpm patch\` or an ` +
        `\`overrides:\` entry, neither of which this analyzer proves safe.`,
      widenings: [],
    }
  }
  const widenings: RangeWidening[] = []
  for (const blocker of judged.blockedBy) {
    const row = findConsumerEvidence(evidence, blocker.consumer)!
    const declaredRange = blocker.range!
    const proposedRange = unionRangeWith(declaredRange, target)
    if (!satisfies(target, proposedRange)) {
      return {
        ...base,
        status: 'unproven',
        unprovenReason:
          `the widened range \`${proposedRange}\` does not admit ${target} ` +
          `under this ecosystem's range grammar, so widening ` +
          `${blocker.consumer} was not proven to collapse the family.`,
        widenings: [],
      }
    }
    if (!satisfies(row.resolvedVersion, proposedRange)) {
      return {
        ...base,
        status: 'unproven',
        unprovenReason:
          `the widened range \`${proposedRange}\` drops ` +
          `${row.resolvedVersion}, the version ${blocker.consumer} resolves ` +
          `to today, so it narrows instead of widening.`,
        widenings: [],
      }
    }
    widenings.push({
      consumer: blocker.consumer,
      consumerKind: row.consumerKind,
      declaredRange,
      proposedRange,
    })
  }
  return {
    ...base,
    status: 'consolidatable-by-widening',
    unprovenReason: undefined,
    widenings,
  }
}

/**
 * Name the consumers whose declared range could not be read, with the reason
 * each one gave. This is the whole point of the `inconclusive` verdict: a
 * version that satisfies every range that WAS read can still break the one that
 * was not.
 */
export function describeUnreadableRanges(
  evidence: FamilyEvidence,
  blind: readonly ConsumerConstraint[],
): string {
  const parts = blind.map(blocker => {
    const row = findConsumerEvidence(evidence, blocker.consumer)
    const why = row?.unreadableReason ?? 'the lockfile records no specifier'
    return `${blocker.consumer} (${why})`
  })
  const subject =
    parts.length === 1 ? '1 consumer states' : `${parts.length} consumers state`
  return (
    `no verdict — ${subject} a range this adapter could not read: ` +
    `${parts.join('; ')}.`
  )
}

/**
 * Judge every family an adapter read, name-ordered so two runs over the same
 * tree print in the same order.
 */
export function buildConsolidationCandidates(config: {
  readonly purlType: string
  readonly readings: readonly FamilyReading[]
}): readonly ConsolidationCandidate[] {
  const { purlType, readings } = config
  return readings
    .map(reading => buildConsolidationCandidate({ purlType, reading }))
    .toSorted((a, b) => a.evidence.name.localeCompare(b.evidence.name))
}
