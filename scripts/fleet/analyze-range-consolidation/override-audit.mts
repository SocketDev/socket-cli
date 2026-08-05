/*
 * @file Audit the overrides a repo already carries: which of them buy nothing,
 *   which are holding the tree together, and which this run could not measure.
 *
 *   `verdict.mts` answers a question about a DUPLICATED family, so it only ever
 *   sees a package that resolved more than once. An override that collapsed its
 *   family down to a single version is invisible to that pass, which is exactly
 *   the override worth finding: the fleet's override map carries a
 *   hand-justified entry per line, and every entry that was never needed is a
 *   paragraph of safety analysis nobody had to write.
 *
 *   So this pass walks EVERY override entry, whatever its family resolved to,
 *   and lands each one in one of three classes:
 *
 *   - `retirable` — the family resolves to ONE version, every declared range
 *     across the tree was read, every one of them admits that version, and all
 *     of them are the SAME range. That last clause is the proof rather than a
 *     formality: pnpm resolves each distinct range on its own, so two ranges
 *     that both admit the resolved version can still float onto two versions
 *     once the override stops forcing one. One range cannot split.
 *   - `load-bearing` — retiring it would change what resolves. Either the entry
 *     redirects the package to a different one, so retiring it swaps the
 *     implementation, or some consumer's declared range excludes the version it
 *     resolved to, which means the override is what moved that consumer.
 *   - `unproven` — everything else, always with the reason. Several distinct
 *     ranges that all admit the version, a range nobody could read, a family
 *     with no resolution in this tree, an entry this repo never applied.
 *
 *   The asymmetry between the classes is deliberate. `load-bearing` is an
 *   EXISTENCE proof, so one forced consumer settles it even while other ranges
 *   stay unreadable. `retirable` is a UNIVERSAL claim, so it needs every range
 *   read and every one of them checked. Anything short of that is `unproven`,
 *   never a quiet `retirable`: recommending the removal of an override that was
 *   holding a duplicate down reintroduces that duplicate in every repo the
 *   entry cascades to.
 *
 *   A `retirable` row says the entry is redundant AS A DEDUPLICATION DEVICE.
 *   An entry that also carries a security floor, forcing consumers off a
 *   vulnerable range, still earns that floor once the duplicate argument is
 *   gone, so read the entry's own comment before removing it.
 *
 *   Pure. Every input is passed in, so there is no lockfile read, no registry
 *   call, and no clock, and nothing here writes an override or edits a
 *   manifest.
 */

import { describeUnreadableRanges } from './adapter.mts'
import type {
  ConsumerEvidence,
  ConsumerKind,
  FamilyEvidence,
} from './adapter.mts'

export type OverrideAuditClass = 'load-bearing' | 'retirable' | 'unproven'

// Which map an entry came from. `fleet-canonical` entries are the ones the
// wheelhouse cascades to every member, so their count is the fleet-wide payoff
// number; a `repo-specific` entry answers only for the repo that wrote it.
export type OverrideOrigin = 'fleet-canonical' | 'repo-specific'

// Which measurement settled the row. Absent on an `unproven` row, where the
// reason carries what was missing instead.
export type OverrideAuditProof =
  | 'alias-redirect'
  | 'excluded-pin'
  | 'forced-consumer'
  | 'single-declared-range'

// One override entry as the roster reader found it. `key` is the raw override
// key, so a range-narrowed `minimatch@>=3` keeps its scope; `name` is the
// package it forces. `pinnedVersion` is the single version the entry forces
// when its value reduces to one, and `undefined` when it does not.
export interface OverrideEntry {
  readonly appliedToTree: boolean
  readonly key: string
  readonly name: string
  readonly origin: OverrideOrigin
  readonly pinnedVersion: string | undefined
  readonly redirectsToOtherPackage: boolean
  readonly scopeRange: string | undefined
  readonly value: string
}

// One consumer the override provably moved: it declares a range, and the
// version it actually resolved to sits outside that range.
export interface ForcedConsumerProof {
  readonly consumer: string
  readonly consumerKind: ConsumerKind
  readonly declaredRange: string
  readonly resolvedVersion: string
}

export interface OverrideAuditRow {
  readonly auditClass: OverrideAuditClass
  readonly entry: OverrideEntry
  readonly evidence: FamilyEvidence
  readonly forced: readonly ForcedConsumerProof[]
  readonly provenBy: OverrideAuditProof | undefined
  readonly reason: string
}

export interface OverrideAuditSummary {
  readonly loadBearing: number
  readonly retirable: number
  readonly total: number
  readonly unproven: number
}

export interface OverrideAuditReadFailure {
  readonly ok: false
  // What could not be read, in What / Where / Saw-vs-wanted / Fix order, ready
  // to surface verbatim.
  readonly reason: string
}

export interface OverrideAuditReadSuccess {
  readonly ok: true
  readonly rows: readonly OverrideAuditRow[]
}

export type OverrideAuditRead =
  | OverrideAuditReadFailure
  | OverrideAuditReadSuccess

/**
 * Every consumer whose declared range excludes the version it resolved to. With
 * the override applied, that gap IS the override: nothing else in a pnpm tree
 * rewrites a declared range.
 */
export function findForcedOverrideConsumers(config: {
  readonly evidence: FamilyEvidence
  readonly satisfies: (version: string, range: string) => boolean
}): readonly ForcedConsumerProof[] {
  const { evidence, satisfies } = config
  const forced: ForcedConsumerProof[] = []
  for (const row of evidence.consumers) {
    const { declaredRange } = row
    if (declaredRange === undefined) {
      continue
    }
    if (!satisfies(row.resolvedVersion, declaredRange)) {
      forced.push({
        consumer: row.consumer,
        consumerKind: row.consumerKind,
        declaredRange,
        resolvedVersion: row.resolvedVersion,
      })
    }
  }
  return forced
}

/**
 * Every consumer whose declared range could not be read, each carrying the
 * reason it could not.
 */
export function findUnreadableOverrideRanges(
  evidence: FamilyEvidence,
): readonly ConsumerEvidence[] {
  return evidence.consumers.filter(row => row.declaredRange === undefined)
}

/**
 * Every consumer whose declared range excludes one specific version, which is
 * how a collapse target is tested against ranges that resolved elsewhere.
 */
export function findOverrideRangesExcluding(config: {
  readonly evidence: FamilyEvidence
  readonly satisfies: (version: string, range: string) => boolean
  readonly version: string
}): readonly ConsumerEvidence[] {
  const { evidence, satisfies, version } = config
  return evidence.consumers.filter(
    row =>
      row.declaredRange !== undefined && !satisfies(version, row.declaredRange),
  )
}

/**
 * The distinct declared ranges across a family. Size 1 is the proof that no
 * split can follow a retirement, since one range resolves to one version.
 */
export function collectDeclaredRangeSet(
  evidence: FamilyEvidence,
): ReadonlySet<string> {
  const ranges = new Set<string>()
  for (const row of evidence.consumers) {
    if (row.declaredRange !== undefined) {
      ranges.add(row.declaredRange)
    }
  }
  return ranges
}

/**
 * Name the consumers one forced-consumer proof rests on, shortened to the first
 * two so a report line stays readable.
 */
export function describeForcedConsumers(
  forced: readonly ForcedConsumerProof[],
): string {
  const named = forced
    .slice(0, 2)
    .map(
      row =>
        `${row.consumer} declares ${row.declaredRange} yet resolved ${row.resolvedVersion}`,
    )
    .join('; ')
  const rest = forced.length - Math.min(forced.length, 2)
  return rest > 0 ? `${named}, and ${rest} more` : named
}

/**
 * Classify one override entry against the family it forces.
 *
 * The order of the checks is the order of the doubts. An entry this repo never
 * applied is measured against a tree that never had it, so it settles first. A
 * redirect and a forced consumer come next, both existence proofs that hold
 * even when other ranges stay unreadable. Only then do the universal checks
 * run, each of which has to hold over EVERY consumer for the entry to be
 * called redundant.
 */
export function classifyOverrideAudit(config: {
  readonly entry: OverrideEntry
  readonly evidence: FamilyEvidence
  readonly satisfies: (version: string, range: string) => boolean
}): OverrideAuditRow {
  const { entry, evidence, satisfies } = config
  const { key, name } = entry
  const forced = findForcedOverrideConsumers({ evidence, satisfies })
  const base = { entry, evidence, forced }
  if (!entry.appliedToTree) {
    return {
      ...base,
      auditClass: 'unproven',
      provenBy: undefined,
      reason:
        `this repo's applied \`overrides:\` block carries no \`${key}\` ` +
        `entry, so the measured tree never resolved under it and this run ` +
        `says nothing about what it holds.`,
    }
  }
  if (entry.redirectsToOtherPackage) {
    return {
      ...base,
      auditClass: 'load-bearing',
      provenBy: 'alias-redirect',
      reason:
        `\`${key}\` redirects ${name} to ${entry.value}, a different ` +
        `package, so retiring it restores the upstream implementation ` +
        `instead of relaxing a version.`,
    }
  }
  if (forced.length > 0) {
    return {
      ...base,
      auditClass: 'load-bearing',
      provenBy: 'forced-consumer',
      reason:
        `${describeForcedConsumers(forced)}, so the override is what moved ` +
        `that consumer and retiring it sends it back to a version its own ` +
        `range admits.`,
    }
  }
  const { resolvedVersions } = evidence
  if (resolvedVersions.length === 0) {
    return {
      ...base,
      auditClass: 'unproven',
      provenBy: undefined,
      reason:
        `no registry version of ${name} resolved in this repo's tree, so ` +
        `this run measures nothing about what \`${key}\` collapses ` +
        `elsewhere.`,
    }
  }
  if (resolvedVersions.length > 1) {
    return {
      ...base,
      auditClass: 'unproven',
      provenBy: undefined,
      reason:
        `${name} still resolves to ${resolvedVersions.length} versions with ` +
        `the override applied, ${resolvedVersions.join(' and ')}, and no ` +
        `declared range excludes the version it resolved to, so what ` +
        `\`${key}\` holds was not measured.`,
    }
  }
  const blind = findUnreadableOverrideRanges(evidence)
  if (blind.length > 0) {
    return {
      ...base,
      auditClass: 'unproven',
      provenBy: undefined,
      reason: describeUnreadableRanges(
        evidence,
        blind.map(row => ({ consumer: row.consumer, range: undefined })),
      ),
    }
  }
  if (evidence.consumers.length === 0) {
    return {
      ...base,
      auditClass: 'unproven',
      provenBy: undefined,
      reason:
        `${name} resolves to ${resolvedVersions[0]} yet no consumer of it ` +
        `could be located, so there is no declared range to call ` +
        `\`${key}\` redundant against.`,
    }
  }
  const target = resolvedVersions[0]!
  const excluding = findOverrideRangesExcluding({
    evidence,
    satisfies,
    version: target,
  })
  if (excluding.length > 0) {
    return {
      ...base,
      auditClass: 'load-bearing',
      provenBy: 'excluded-pin',
      reason:
        `${excluding[0]!.consumer} declares ${excluding[0]!.declaredRange}, ` +
        `which excludes the ${target} this override pins, so retiring it ` +
        `moves that consumer off ${target}.`,
    }
  }
  const declaredRanges = collectDeclaredRangeSet(evidence)
  if (declaredRanges.size > 1) {
    return {
      ...base,
      auditClass: 'unproven',
      provenBy: undefined,
      reason:
        `${name} resolves to ${target} and all ` +
        `${declaredRanges.size} declared ranges admit it, but pnpm resolves ` +
        `each range on its own, so proving no split needs the counterfactual ` +
        `resolution this analyzer does not run: re-resolve the lockfile with ` +
        `\`${key}\` removed and compare.`,
    }
  }
  return {
    ...base,
    auditClass: 'retirable',
    provenBy: 'single-declared-range',
    reason:
      `every consumer of ${name} declares the same range, ` +
      `${[...declaredRanges][0]}, and it admits the one resolved version ` +
      `${target}, so one version resolves with or without \`${key}\`.`,
  }
}

/**
 * Key-ordered rows, so two runs over the same tree print in the same order.
 */
export function sortOverrideAuditRows(
  rows: readonly OverrideAuditRow[],
): readonly OverrideAuditRow[] {
  return rows.toSorted((a, b) => a.entry.key.localeCompare(b.entry.key))
}

/**
 * The count per class plus the total, which is the number the payoff metric
 * asks for: how many hand-justified override entries were never needed.
 */
export function summarizeOverrideAudit(
  rows: readonly OverrideAuditRow[],
): OverrideAuditSummary {
  let loadBearing = 0
  let retirable = 0
  let unproven = 0
  for (let i = 0, { length } = rows; i < length; i += 1) {
    const { auditClass } = rows[i]!
    if (auditClass === 'retirable') {
      retirable += 1
    } else if (auditClass === 'load-bearing') {
      loadBearing += 1
    } else {
      unproven += 1
    }
  }
  return { loadBearing, retirable, total: rows.length, unproven }
}

/**
 * The rows one map contributed, so the fleet-canonical count stays separable
 * from a repo's own entries.
 */
export function filterOverrideAuditByOrigin(
  rows: readonly OverrideAuditRow[],
  origin: OverrideOrigin,
): readonly OverrideAuditRow[] {
  return rows.filter(row => row.entry.origin === origin)
}
