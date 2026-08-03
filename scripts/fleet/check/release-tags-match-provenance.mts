#!/usr/bin/env node
/*
 * @file Assertion: for every recently-published version of this repo's npm
 *   package, SOME git tag on origin points at the commit npm's SLSA provenance
 *   says produced the artifact. The tag is the only human-navigable handle on
 *   a release; provenance is the only cryptographic one. When they disagree,
 *   `git checkout v6.5.0` hands you a tree that is not what shipped.
 *
 *   THE ARBITER IS THE ATTESTATION, NOT THE TAG NAME. A `v*` tag is immutable
 *   under the `fleet-tag-protection` ruleset (deletion + non_fast_forward, zero
 *   bypass actors), so a release that lands broken cannot have its tag moved or
 *   deleted — a BARE-semver tag (`0.0.19`, no `v`) is the sanctioned corrective
 *   marker. Two tags for one version is therefore a legitimate state, not a
 *   defect: whichever one resolves to the attested commit is authoritative and
 *   the other is a historical marker. This gate flags only the case where
 *   NEITHER resolves there. See docs/agents.md/fleet/release-tag-escape-hatch.md.
 *
 *   PEEL EVERY TAG. An annotated tag's own object SHA is not a commit SHA, and
 *   reading it unpeeled is what makes an escape-hatch pair look like two tags
 *   at different commits when both peel to the same one. `git ls-remote --tags`
 *   emits the peeled commit on the sibling `^{}` line; `parseRemoteTagCommits`
 *   always prefers it.
 *
 *   Scope — the FIVE most recently published stable versions (`--limit N` /
 *   `--all` widen it, `--version` targets one). A tag can still be reconciled
 *   for a recent release; older releases are frozen history whose provenance
 *   predates the discipline, and one HTTP read per version makes an
 *   every-version sweep too slow for a gate. Prereleases are out of scope — the
 *   publish tail never tags them.
 *
 *   THE BASELINE IS A RATCHET. A pre-existing defect's only remedy is a HUMAN
 *   DECISION about immutable published history, so a blocking gate over frozen
 *   history means main stays red indefinitely — the failure mode, not the
 *   finding. `release.provenanceOrphanBaseline` in
 *   `.config/repo/socket-wheelhouse.json` grandfathers those versions: each is
 *   still reported (loudly, every run, quiet included) but does not fail. A
 *   version NOT in the baseline still fails — a new one is a regression. And a
 *   baseline entry whose version has since been reconciled fails as STALE, so
 *   the list can only shrink. See docs/agents.md/fleet/release-tag-escape-hatch.md.
 *
 *   It covers BOTH frozen-history kinds: an `orphaned` version, whose
 *   attestation no release tag reaches, and an `unprovenanced` one, published
 *   with no attestation at all. npm mints an attestation at publish time and it
 *   is immutable, so neither is repairable after the fact — the same argument
 *   that justifies grandfathering the first applies verbatim to the second.
 *   Baselining `unprovenanced` does NOT weaken the gate on new releases: a
 *   version absent from the list still fails, which is what forces every future
 *   publish through the pipeline with `publishConfig.provenance:true`.
 *
 *   NEVER FALSE-GREEN. Three outcomes are tracked separately and only the first
 *   prints a success line: a version whose tag matches, a version the registry
 *   ANSWERED has no provenance (a release defect — exit 1), and a version whose
 *   provenance could not be READ (offline lane, 5xx, unparseable bundle — exit
 *   0, because an unreadable source is not a violation, but reported as NOT
 *   VERIFIED and never counted as a pass). Zero candidate versions says so out
 *   loud rather than succeeding vacuously.
 *
 *   Read-only. Creating or moving a release tag is a human decision.
 *
 *   Usage: node scripts/fleet/check/release-tags-match-provenance.mts
 *            [--repo <dir>] [--version <v>] [--limit <n>] [--all] [--quiet]
 */

import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { joinAnd } from '@socketsecurity/lib-stable/arrays/join'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { loadSocketWheelhouseConfig, REPO_ROOT } from '../paths.mts'
import { fetchRegistryReleaseState } from '../publish-infra/npm/registry.mts'
import type { RegistryReleaseState } from '../publish-infra/npm/registry.mts'
import { fetchAttestedGitSource } from '../publish-infra/npm/provenance.mts'
import type {
  AttestationRead,
  ProvenanceReader,
} from '../publish-infra/npm/provenance.mts'
import { resolveNpmWorkspaceLayout } from '../publish-infra/npm/workspace.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { probeMembership } from '../_shared/fleet-membership.mts'
import type { MembershipProbe } from '../_shared/fleet-membership.mts'

const logger = getDefaultLogger()

const CHECK_NAME = 'release-tags-match-provenance'

// The actionable window — see the @file scope note.
const DEFAULT_VERSION_LIMIT = 5

// A `git ls-remote --tags` line: `<sha>\trefs/tags/<name>`, where the sibling
// `<name>^{}` line carries the peeled commit for an annotated tag.
const REMOTE_TAG_LINE_RE = /^([0-9a-f]{40})\s+refs\/tags\/(\S+?)(\^\{\})?$/

// The ref a provenance `uri` names, e.g.
// `git+https://github.com/SocketDev/socket-mcp@refs/heads/main`.
const PROVENANCE_URI_REF_RE = /@(refs\/[^@]+)$/

/*
 * The fleet's own publish workflows attest `refs/heads/main` today (verified
 * 2026-07-30 across @socketsecurity/{lib,mcp,sdk} and @socketsecurity/registry
 * — every one names a branch), because the version bump happens inside the
 * publish run. A tag-triggered release would attest `refs/tags/…` and make
 * tag/commit/manifest coincide BY CONSTRUCTION rather than by timing, which is
 * the stronger model. Flipping this to 'strict' is the ratchet for that
 * restructure; until it lands, a branch ref is reported, not failed — the
 * orphan assertion above already catches the case where the in-run bump
 * actually broke the tag/provenance correspondence.
 */
export type TagRefMode = 'report' | 'strict'

export const TAG_REF_MODE: TagRefMode = 'report'

/**
 * A git tag resolved to the commit it ultimately points at.
 */
export interface ReleaseTagTarget {
  commit: string
  tag: string
}

/**
 * What one published version's tags and provenance say about each other.
 * `matched` — some tag resolves to the attested commit. `orphaned` — provenance
 * named a commit no tag points at. `unprovenanced` — the registry answered that
 * the version has no SLSA statement. `unreadable` — the question could not be
 * asked.
 */
export type ProvenanceVerdictKind =
  | 'matched'
  | 'orphaned'
  | 'unprovenanced'
  | 'unreadable'

export interface ReleaseTagProvenanceVerdict {
  attestedCommit: string | undefined
  attestedRef: string | undefined
  // The tag that resolves to the attested commit, when one does.
  authoritativeTag: string | undefined
  // Set only on an `orphaned` verdict the committed baseline grandfathers —
  // the entry's reason. Its presence is what downgrades the finding to
  // informational.
  baselineReason: string | undefined
  detail: string | undefined
  // Tags for this version pointing somewhere OTHER than the attested commit —
  // the escape-hatch marker when `authoritativeTag` is set. Informational.
  historicalTags: ReleaseTagTarget[]
  kind: ProvenanceVerdictKind
  presentTags: ReleaseTagTarget[]
  version: string
}

/**
 * Map every tag origin carries to the COMMIT it resolves to. An annotated tag
 * contributes two lines — its tag-object SHA and, on the `^{}` sibling, the
 * peeled commit — and the peeled value always wins. Pure.
 */
export function parseRemoteTagCommits(stdout: string): Map<string, string> {
  const direct = new Map<string, string>()
  const peeled = new Map<string, string>()
  const lines = stdout.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const match = REMOTE_TAG_LINE_RE.exec(lines[i]!.trim())
    if (!match) {
      continue
    }
    const [, sha, tag, peel] = match
    if (peel) {
      peeled.set(tag!, sha!)
    } else {
      direct.set(tag!, sha!)
    }
  }
  for (const [tag, sha] of peeled) {
    direct.set(tag, sha)
  }
  return direct
}

/**
 * The two tag spellings a fleet release may carry for one version: the
 * canonical `v<version>` and the bare-semver escape hatch. Pure.
 */
export function releaseTagSpellings(version: string): string[] {
  return [`v${version}`, version]
}

/**
 * The ref a provenance `uri` checked out, or undefined when the uri names
 * none. Pure.
 */
export function attestedRefFromUri(
  uri: string | undefined,
): string | undefined {
  if (!uri) {
    return undefined
  }
  const match = PROVENANCE_URI_REF_RE.exec(uri)
  return match ? match[1] : undefined
}

/**
 * True for a ref that names a branch rather than a tag — the bump-in-CI release
 * shape, where the attested tree is whatever the branch held mid-run. Pure.
 */
export function isBranchRefName(ref: string | undefined): boolean {
  return typeof ref === 'string' && ref.startsWith('refs/heads/')
}

/**
 * The verdict for one published version, given its attestation read and the
 * origin tag index. Pure — the whole classification is testable with an
 * injected read and a hand-built tag map, no network and no git. Tag
 * comparison is prefix-tolerant so a short attested SHA still resolves.
 */
export function classifyReleaseTagProvenance(config: {
  read: AttestationRead
  tagCommits: ReadonlyMap<string, string>
  version: string
}): ReleaseTagProvenanceVerdict {
  const cfg = { __proto__: null, ...config } as typeof config
  const presentTags: ReleaseTagTarget[] = []
  const spellings = releaseTagSpellings(cfg.version)
  for (let i = 0, { length } = spellings; i < length; i += 1) {
    const tag = spellings[i]!
    const commit = cfg.tagCommits.get(tag)
    if (commit) {
      presentTags.push({ commit, tag })
    }
  }
  const base = {
    attestedCommit: undefined,
    attestedRef: undefined,
    authoritativeTag: undefined,
    baselineReason: undefined,
    detail: undefined,
    historicalTags: [],
    presentTags,
    version: cfg.version,
  }
  if (cfg.read.kind !== 'attested') {
    return { ...base, detail: cfg.read.detail, kind: cfg.read.kind }
  }
  const attestedCommit = cfg.read.source.gitCommit
  const attestedRef = attestedRefFromUri(cfg.read.source.uri)
  const matching = presentTags.filter(t => shaMatches(t.commit, attestedCommit))
  const historicalTags = presentTags.filter(
    t => !shaMatches(t.commit, attestedCommit),
  )
  return {
    ...base,
    attestedCommit,
    attestedRef,
    authoritativeTag: matching[0]?.tag,
    historicalTags: matching.length > 0 ? historicalTags : [],
    kind: matching.length > 0 ? 'matched' : 'orphaned',
  }
}

/**
 * Whether two git object names denote the same commit, tolerating an
 * abbreviated form on either side. Pure.
 */
export function shaMatches(a: string, b: string | undefined): boolean {
  if (!b) {
    return false
  }
  const shorter = a.length <= b.length ? a : b
  const longer = a.length <= b.length ? b : a
  return shorter.length >= 7 && longer.startsWith(shorter)
}

/**
 * The versions to audit: dated stable releases, newest first, capped at
 * `limit`. Ordering is by PUBLISH TIME rather than semver so a backfilled
 * version sorts where it actually shipped. Pure.
 */
export function selectProvenanceAuditVersions(config: {
  limit: number
  timeMap: Readonly<Record<string, string>>
  versions: readonly string[]
}): string[] {
  const cfg = { __proto__: null, ...config } as typeof config
  const dated: Array<{ publishedAt: string; version: string }> = []
  for (let i = 0, { length } = cfg.versions; i < length; i += 1) {
    const version = cfg.versions[i]!
    const publishedAt = cfg.timeMap[version]
    if (publishedAt && !version.includes('-')) {
      dated.push({ publishedAt, version })
    }
  }
  return dated
    .toSorted((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, Math.max(0, cfg.limit))
    .map(entry => entry.version)
}

/**
 * One grandfathered provenance orphan, as committed to
 * `.config/repo/socket-wheelhouse.json` under
 * `release.provenanceOrphanBaseline`.
 */
export interface ProvenanceOrphanBaselineEntry {
  id: string
  reason: string
}

/**
 * The `<pkg>@<version>` key a baseline entry is matched on. Pure.
 */
export function provenanceArtifactId(name: string, version: string): string {
  return `${name}@${version}`
}

/**
 * The baseline entries in a parsed socket-wheelhouse config value. Anything
 * not shaped `{ id, reason }` with both non-empty is DROPPED rather than
 * throwing: a malformed entry must never grandfather an orphan by accident,
 * and dropping it makes the gate fail loudly on that version instead. Pure.
 */
export function parseProvenanceOrphanBaseline(
  configValue: unknown,
): ProvenanceOrphanBaselineEntry[] {
  const raw = (
    configValue as
      | {
          release?:
            | { provenanceOrphanBaseline?: unknown | undefined }
            | undefined
        }
      | undefined
  )?.release?.provenanceOrphanBaseline
  if (!Array.isArray(raw)) {
    return []
  }
  const entries: ProvenanceOrphanBaselineEntry[] = []
  for (let i = 0, { length } = raw; i < length; i += 1) {
    const entry = raw[i] as
      | { id?: unknown | undefined; reason?: unknown | undefined }
      | undefined
    if (
      entry &&
      typeof entry.id === 'string' &&
      entry.id.length > 0 &&
      typeof entry.reason === 'string' &&
      entry.reason.length > 0
    ) {
      entries.push({ id: entry.id, reason: entry.reason })
    }
  }
  return entries
}

/**
 * The verdicts with every baseline-covered orphan carrying its reason, which
 * is what downgrades it from a failure to an informational line. Only an
 * `orphaned` verdict can be grandfathered — a baseline entry never suppresses
 * an unprovenanced or unreadable version. Pure.
 */
export function applyProvenanceBaseline(config: {
  baseline: readonly ProvenanceOrphanBaselineEntry[]
  name: string
  verdicts: readonly ReleaseTagProvenanceVerdict[]
}): ReleaseTagProvenanceVerdict[] {
  const cfg = { __proto__: null, ...config } as typeof config
  const reasons = new Map<string, string>()
  for (let i = 0, { length } = cfg.baseline; i < length; i += 1) {
    const entry = cfg.baseline[i]!
    reasons.set(entry.id, entry.reason)
  }
  return cfg.verdicts.map(verdict => {
    // Both frozen-history kinds are grandfatherable. An `orphaned` version has
    // an attestation no release tag reaches; an `unprovenanced` one has no
    // attestation at all. Neither can be repaired after publish — npm mints the
    // attestation at publish time and it is immutable — so both are the "human
    // decision about immutable history" case the baseline exists for.
    if (verdict.kind !== 'orphaned' && verdict.kind !== 'unprovenanced') {
      return verdict
    }
    const reason = reasons.get(provenanceArtifactId(cfg.name, verdict.version))
    return reason === undefined
      ? verdict
      : { ...verdict, baselineReason: reason }
  })
}

/**
 * Baseline entries whose version was AUDITED this run and came back matched —
 * the orphan was reconciled, so the entry is dead weight. Failing on these is
 * the half of the ratchet that makes the list shrink; without it a baseline
 * rots into a permanent suppression. An entry for a version outside the audit
 * window is NOT stale, because the audit never asked about that version, so
 * ageing out of the window can never fail the gate. Pure.
 */
export function findStaleBaselineEntries(config: {
  baseline: readonly ProvenanceOrphanBaselineEntry[]
  name: string
  verdicts: readonly ReleaseTagProvenanceVerdict[]
}): ProvenanceOrphanBaselineEntry[] {
  const cfg = { __proto__: null, ...config } as typeof config
  const reconciled = new Set<string>()
  for (let i = 0, { length } = cfg.verdicts; i < length; i += 1) {
    const verdict = cfg.verdicts[i]!
    if (verdict.kind === 'matched') {
      reconciled.add(provenanceArtifactId(cfg.name, verdict.version))
    }
  }
  return cfg.baseline.filter(entry => reconciled.has(entry.id))
}

/**
 * The four-part finding for a baseline entry that no longer describes an
 * orphan. Pure.
 */
export function formatStaleBaselineFinding(
  entry: ProvenanceOrphanBaselineEntry,
): string {
  return [
    `  What:  the provenance-orphan baseline still lists ${entry.id}, but that version now resolves to its attested commit.`,
    `  Where: .config/repo/socket-wheelhouse.json, release.provenanceOrphanBaseline`,
    `  Saw:   a baseline entry ("${entry.reason}") for a version the audit found MATCHED.`,
    `         Wanted: the baseline to carry only versions that are still orphans.`,
    `  Fix:   delete the ${entry.id} entry. The baseline may only shrink — a reconciled version leaving it is the point.`,
  ].join('\n')
}

export interface ProvenanceAuditSummary {
  // Orphans covered by the committed baseline. Counted INSIDE `orphaned` too,
  // so the two are never confused for one another.
  baselinedOrphans: number
  // Unprovenanced versions covered by the committed baseline. Counted INSIDE
  // `unprovenanced` too, same as the orphan pair above. An attestation is
  // produced at publish time and is immutable, so a version released before
  // the provenance pipeline can NEVER gain one — it is frozen history in
  // exactly the sense the baseline exists for.
  baselinedUnprovenanced: number
  branchRefs: number
  escapeHatchPairs: number
  matched: number
  orphaned: number
  staleBaseline: number
  unprovenanced: number
  unreadable: number
}

/**
 * Tally the verdicts. Every non-`matched` outcome keeps its own counter so the
 * caller can never collapse "could not check" into "checked and fine".
 * `staleBaseline` comes from {@link findStaleBaselineEntries}, which needs the
 * baseline the verdicts alone do not carry. Pure.
 */
export function summarizeProvenanceVerdicts(
  verdicts: readonly ReleaseTagProvenanceVerdict[],
  options?: { staleBaseline?: number | undefined } | undefined,
): ProvenanceAuditSummary {
  const opts = { __proto__: null, ...options } as NonNullable<typeof options>
  const summary: ProvenanceAuditSummary = {
    baselinedOrphans: 0,
    baselinedUnprovenanced: 0,
    branchRefs: 0,
    escapeHatchPairs: 0,
    matched: 0,
    orphaned: 0,
    staleBaseline: opts.staleBaseline ?? 0,
    unprovenanced: 0,
    unreadable: 0,
  }
  for (let i = 0, { length } = verdicts; i < length; i += 1) {
    const verdict = verdicts[i]!
    summary[verdict.kind] += 1
    if (verdict.kind === 'orphaned' && verdict.baselineReason !== undefined) {
      summary.baselinedOrphans += 1
    }
    if (
      verdict.kind === 'unprovenanced' &&
      verdict.baselineReason !== undefined
    ) {
      summary.baselinedUnprovenanced += 1
    }
    if (isBranchRefName(verdict.attestedRef)) {
      summary.branchRefs += 1
    }
    if (verdict.authoritativeTag && verdict.historicalTags.length > 0) {
      summary.escapeHatchPairs += 1
    }
  }
  return summary
}

/**
 * True when the audit may print a success line: at least one version was
 * actually verified and nothing failed OR went unread. `mode` defaults to the
 * shipped {@link TAG_REF_MODE} and is a parameter so the strict arm — the
 * ratchet for a tag-triggered release — is exercised by tests today. Pure.
 */
export function provenanceAuditPassed(
  summary: ProvenanceAuditSummary,
  mode: TagRefMode = TAG_REF_MODE,
): boolean {
  return (
    summary.matched > 0 &&
    summary.orphaned - summary.baselinedOrphans === 0 &&
    summary.staleBaseline === 0 &&
    summary.unprovenanced - summary.baselinedUnprovenanced === 0 &&
    summary.unreadable === 0 &&
    (mode === 'report' || summary.branchRefs === 0)
  )
}

/**
 * True when the audit must exit non-zero. An unread source is deliberately NOT
 * a failure — it is un-checkable, and an offline CI lane must not go red — but
 * it also never earns the success line above. A BASELINED orphan is likewise
 * not a failure: it is frozen history whose only remedy is a human decision
 * about an immutable tag, so blocking on it would red main forever. A stale
 * baseline entry IS a failure, which is what keeps the list shrinking. Pure.
 */
export function provenanceAuditFailed(
  summary: ProvenanceAuditSummary,
  mode: TagRefMode = TAG_REF_MODE,
): boolean {
  return (
    summary.orphaned - summary.baselinedOrphans > 0 ||
    summary.staleBaseline > 0 ||
    summary.unprovenanced - summary.baselinedUnprovenanced > 0 ||
    (mode === 'strict' && summary.branchRefs > 0)
  )
}

/**
 * The four-part (What / Where / Saw vs. wanted / Fix) finding for one failing
 * version. Read-only tooling, so the Fix names the human decision rather than a
 * command that would mutate a protected tag. Pure.
 */
export function formatProvenanceFinding(config: {
  name: string
  verdict: ReleaseTagProvenanceVerdict
}): string {
  const cfg = { __proto__: null, ...config } as typeof config
  const { verdict } = cfg
  const subject = `${cfg.name}@${verdict.version}`
  if (verdict.kind === 'unprovenanced') {
    return [
      `  What:  ${subject} is public on npm with NO SLSA provenance, so no commit can be proven to have produced it.`,
      `  Where: check/${CHECK_NAME}, over the npm attestation endpoint`,
      `  Saw:   ${verdict.detail ?? 'no SLSA attestation'}.`,
      `         Wanted: a SLSA provenance statement naming the source commit.`,
      `  Fix:   publish through the pipeline with publishConfig.provenance:true (check/publish-config-is-hardened).`,
      `         A published version cannot gain provenance retroactively — the next release must carry it.`,
    ].join('\n')
  }
  const seen =
    verdict.presentTags.length === 0
      ? 'no v<version> or bare-semver tag on origin at all'
      : `${joinAnd(verdict.presentTags.map(t => `${t.tag} -> ${t.commit.slice(0, 9)}`))}`
  return [
    `  What:  ${subject} is a PROVENANCE ORPHAN — the commit npm attests is not reachable by any release tag.`,
    `  Where: check/${CHECK_NAME}, over the npm attestation endpoint + git ls-remote --tags origin`,
    `  Saw:   attested commit ${verdict.attestedCommit ?? '(none)'}${verdict.attestedRef ? ` via ${verdict.attestedRef}` : ''}; tags: ${seen}.`,
    `         Wanted: v${verdict.version} or the bare ${verdict.version} tag resolving to ${verdict.attestedCommit ?? 'the attested commit'}.`,
    `  Fix:   HUMAN DECISION — verify the attested commit is the tree that shipped, then push a bare`,
    `         \`${verdict.version}\` tag at it (the v* tag is immutable under fleet-tag-protection and must NOT`,
    `         be moved or deleted). Never tag a commit you have not confirmed against the published bytes.`,
  ].join('\n')
}

/**
 * Run the provenance read for each version through the injected reader and
 * classify it. The reader is a seam so tests exercise every branch offline.
 */
export async function auditReleaseTagProvenance(config: {
  readProvenance: ProvenanceReader
  name: string
  tagCommits: ReadonlyMap<string, string>
  versions: readonly string[]
}): Promise<ReleaseTagProvenanceVerdict[]> {
  const cfg = { __proto__: null, ...config } as typeof config
  const verdicts: ReleaseTagProvenanceVerdict[] = []
  for (let i = 0, { length } = cfg.versions; i < length; i += 1) {
    const version = cfg.versions[i]!
    // Serial by design: a release gate must not burst the registry, and the
    // window is five reads.
    const read = await cfg.readProvenance(cfg.name, version)
    verdicts.push(
      classifyReleaseTagProvenance({
        read,
        tagCommits: cfg.tagCommits,
        version,
      }),
    )
  }
  return verdicts
}

/**
 * `git ls-remote --tags origin` for a checkout, or undefined when origin is
 * unreachable — an unreadable remote is un-checkable, not a violation.
 *
 * Only the failure arm is unit-tested. `git ls-remote` against a local-path
 * remote runs the remote side through `/bin/sh -c 'git-upload-pack …'`, and a
 * shell spawn is exactly what an endpoint-security agent inspects synchronously
 * — measured at 0.5-18s per spawn with no bounded tail. A bare-repo fixture for
 * the success arm is therefore a flake generator, so this whole function is a
 * SEAM instead: {@link ProvenanceAuditIo.readOriginTags} carries it, and the
 * audit's tag handling is covered through injected stdout.
 */
export async function readOriginTagRefs(
  cwd: string,
): Promise<string | undefined> {
  try {
    const r = (await spawn('git', ['ls-remote', '--tags', 'origin'], {
      cwd,
      stdio: 'pipe',
      stdioString: true,
    })) as { stdout?: string | undefined }
    return String(r?.stdout ?? '')
  } catch {
    return undefined
  }
}

/**
 * The operator-facing render of every verdict, including the informational
 * escape-hatch and branch-ref notes the summary counts.
 */
export function reportProvenanceVerdicts(config: {
  name: string
  verdicts: readonly ReleaseTagProvenanceVerdict[]
}): void {
  const cfg = { __proto__: null, ...config } as typeof config
  for (let i = 0, { length } = cfg.verdicts; i < length; i += 1) {
    const verdict = cfg.verdicts[i]!
    if (verdict.kind === 'matched') {
      const hatch =
        verdict.historicalTags.length > 0
          ? ` (escape hatch: ${joinAnd(verdict.historicalTags.map(t => `${t.tag} -> ${t.commit.slice(0, 9)}`))} is the historical marker)`
          : ''
      const branch = isBranchRefName(verdict.attestedRef)
        ? ` [attested via ${verdict.attestedRef}, a branch ref — bump-in-CI shape]`
        : ''
      logger.log(
        `  ${verdict.version}: ${verdict.authoritativeTag} -> ${verdict.attestedCommit?.slice(0, 9)}${hatch}${branch}`,
      )
    } else if (verdict.kind === 'unreadable') {
      logger.warn(
        `  ${verdict.version}: NOT VERIFIED — ${verdict.detail ?? 'the provenance read failed'}.`,
      )
    } else if (verdict.kind === 'orphaned' && verdict.baselineReason) {
      // Grandfathered: still an orphan, still visible, just not blocking.
      logger.warn(
        `  ${verdict.version}: BASELINED ORPHAN — attested ${verdict.attestedCommit?.slice(0, 9)} has no release tag; grandfathered (${verdict.baselineReason}).`,
      )
    } else if (verdict.kind === 'unprovenanced' && verdict.baselineReason) {
      // Grandfathered: still unattested, still visible, just not blocking.
      logger.warn(
        `  ${verdict.version}: BASELINED UNPROVENANCED — published with no SLSA attestation, which cannot be added after publish; grandfathered (${verdict.baselineReason}).`,
      )
    } else {
      logger.error(formatProvenanceFinding({ name: cfg.name, verdict }))
    }
  }
}

/**
 * Resolve the audit scope from argv: the checkout to read tags from, the
 * package it publishes, and how many versions to cover.
 */
export interface ProvenanceAuditArgs {
  all: boolean
  limit: number
  quiet: boolean
  repo: string
  version: string | undefined
}

export function parseProvenanceAuditArgs(
  argv: readonly string[],
): ProvenanceAuditArgs {
  const flagValue = (flag: string): string | undefined => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const rawLimit = Number.parseInt(flagValue('--limit') ?? '', 10)
  return {
    all: argv.includes('--all'),
    limit:
      Number.isFinite(rawLimit) && rawLimit > 0
        ? rawLimit
        : DEFAULT_VERSION_LIMIT,
    quiet: argv.includes('--quiet'),
    repo: flagValue('--repo') ?? REPO_ROOT,
    version: flagValue('--version'),
  }
}

/**
 * Every process boundary the audit crosses — git, the filesystem, and the npm
 * registry — as one injectable bag. Each member is a SEAM: with all four
 * supplied, {@link runProvenanceAudit} runs the whole flow in-process against
 * no git remote and no network, which is the only way this gate's glue is
 * testable without a bare-repo fixture (see the flake note on
 * `readOriginTagRefs`).
 */
export interface ProvenanceAuditIo {
  probeRepoMembership: (repo: string) => MembershipProbe
  readOrphanBaseline: (repo: string) => readonly ProvenanceOrphanBaselineEntry[]
  readOriginTags: (repo: string) => Promise<string | undefined>
  readProvenance: ProvenanceReader
  readPublishedName: (repo: string) => string
  readRegistryState: (name: string) => Promise<RegistryReleaseState | undefined>
}

/**
 * The committed orphan baseline for a checkout. An absent or unreadable config
 * yields an EMPTY baseline, so a missing file can never grandfather anything.
 */
export function readProvenanceOrphanBaseline(
  repo: string,
): ProvenanceOrphanBaselineEntry[] {
  return parseProvenanceOrphanBaseline(loadSocketWheelhouseConfig(repo)?.value)
}

/**
 * The production wiring of {@link ProvenanceAuditIo} — the real git, npm, and
 * workspace reads.
 */
export function resolveProvenanceAuditIo(): ProvenanceAuditIo {
  return {
    probeRepoMembership: probeMembership,
    readOrphanBaseline: readProvenanceOrphanBaseline,
    readOriginTags: readOriginTagRefs,
    readProvenance: fetchAttestedGitSource,
    readPublishedName: repo =>
      resolveNpmWorkspaceLayout(repo).versionSource.name,
    readRegistryState: fetchRegistryReleaseState,
  }
}

/**
 * The audit proper: resolve scope, read the registry, read origin's tags,
 * classify, report, and answer with the process exit code — 1 when the gate
 * fails, 0 for every "nothing asserted" and "not verified" outcome, which are
 * un-checkable rather than violations.
 */
export async function runProvenanceAudit(config: {
  args: ProvenanceAuditArgs
  io: ProvenanceAuditIo
}): Promise<number> {
  const cfg = { __proto__: null, ...config } as typeof config
  const { args, io } = cfg
  const probe = io.probeRepoMembership(args.repo)
  if (!probe.member) {
    logger.log(
      `${CHECK_NAME}: ${args.repo} is not a fleet roster member (origin ${probe.originUrl ?? 'absent'}) — nothing asserted.`,
    )
    return 0
  }
  let name = ''
  try {
    name = io.readPublishedName(args.repo)
  } catch {
    name = ''
  }
  if (!name) {
    logger.log(
      `${CHECK_NAME}: no publishable npm package here — nothing to assert.`,
    )
    return 0
  }
  const state = await io.readRegistryState(name)
  if (!state) {
    logger.log(
      `${CHECK_NAME}: NOT VERIFIED — could not read the ${name} packument (unpublished package / offline lane).`,
    )
    return 0
  }
  const candidates = args.version
    ? [args.version]
    : selectProvenanceAuditVersions({
        limit: args.all ? state.versions.length : args.limit,
        timeMap: state.timeMap,
        versions: state.versions,
      })
  if (candidates.length === 0) {
    logger.log(
      `${CHECK_NAME}: ${name} has no dated stable published version — nothing asserted.`,
    )
    return 0
  }
  const tagStdout = await io.readOriginTags(args.repo)
  if (tagStdout === undefined) {
    logger.log(
      `${CHECK_NAME}: NOT VERIFIED — origin tags unreadable (no remote / offline lane).`,
    )
    return 0
  }
  const baseline = io.readOrphanBaseline(args.repo)
  const verdicts = applyProvenanceBaseline({
    baseline,
    name,
    verdicts: await auditReleaseTagProvenance({
      name,
      readProvenance: io.readProvenance,
      tagCommits: parseRemoteTagCommits(tagStdout),
      versions: candidates,
    }),
  })
  const staleEntries = findStaleBaselineEntries({ baseline, name, verdicts })
  const summary = summarizeProvenanceVerdicts(verdicts, {
    staleBaseline: staleEntries.length,
  })
  if (!args.quiet || !provenanceAuditPassed(summary)) {
    logger.log(`${CHECK_NAME}: ${name}, ${candidates.length} version(s)`)
    reportProvenanceVerdicts({ name, verdicts })
  }
  for (let i = 0, { length } = staleEntries; i < length; i += 1) {
    logger.error(formatStaleBaselineFinding(staleEntries[i]!))
  }
  // No silent caps: a grandfathered orphan is stated on EVERY run, quiet
  // included, so the baseline cannot be forgotten into permanence.
  if (summary.baselinedOrphans > 0) {
    logger.warn(
      `${CHECK_NAME}: ${summary.baselinedOrphans} baselined provenance orphan(s) for ${name} — grandfathered history, not a pass. Shrink release.provenanceOrphanBaseline as they are reconciled.`,
    )
  }
  if (summary.baselinedUnprovenanced > 0) {
    logger.warn(
      `${CHECK_NAME}: ${summary.baselinedUnprovenanced} baselined unprovenanced version(s) for ${name} — published with no attestation, which publish froze permanently. Not a pass. Every NEW version must publish through the pipeline with publishConfig.provenance:true.`,
    )
  }
  if (provenanceAuditFailed(summary)) {
    logger.error(
      `[${CHECK_NAME}] ${summary.orphaned - summary.baselinedOrphans} unbaselined provenance orphan(s), ${summary.staleBaseline} stale baseline entry(s), ${summary.unprovenanced - summary.baselinedUnprovenanced} unbaselined unprovenanced version(s).`,
    )
    return 1
  }
  if (summary.unreadable > 0) {
    logger.warn(
      `${CHECK_NAME}: ${summary.matched}/${candidates.length} verified, ${summary.unreadable} NOT VERIFIED — this run is not a pass.`,
    )
    return 0
  }
  if (provenanceAuditPassed(summary)) {
    if (!args.quiet) {
      logger.success(
        `${CHECK_NAME}: every audited ${name} version has a release tag at its attested commit or a baseline entry (${summary.escapeHatchPairs} escape-hatch pair(s), ${summary.branchRefs} branch-ref attestation(s), ${summary.baselinedOrphans} baselined orphan(s)).`,
      )
    }
    return 0
  }
  // Defensive: with every verdict kind counted, a non-empty candidate set that
  // neither failed, went unread, nor matched cannot occur. Left deliberately
  // uncovered rather than c8-ignored — a fifth verdict kind would make this
  // arm live, and an uncovered line is the signal that it did.
  logger.warn(
    `${CHECK_NAME}: nothing was verified for ${name} — this run is not a pass.`,
  )
  return 0
}

export async function main(): Promise<number> {
  return await runProvenanceAudit({
    args: parseProvenanceAuditArgs(process.argv.slice(2)),
    io: resolveProvenanceAuditIo(),
  })
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  main()
    .then(exitCode => {
      if (exitCode !== 0) {
        process.exitCode = exitCode
      }
    })
    .catch((e: unknown) => {
      logger.error(`${CHECK_NAME} failed: ${errorMessage(e)}`)
      process.exitCode = 1
    })
}
/* c8 ignore stop */
