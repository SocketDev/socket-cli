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

import { REPO_ROOT } from '../paths.mts'
import { fetchRegistryReleaseState } from '../publish-infra/npm/registry.mts'
import { fetchAttestedGitSource } from '../publish-infra/npm/provenance.mts'
import type {
  AttestationRead,
  ProvenanceReader,
} from '../publish-infra/npm/provenance.mts'
import { resolveNpmWorkspaceLayout } from '../publish-infra/npm/workspace.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { probeMembership } from '../_shared/fleet-membership.mts'

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
const TAG_REF_MODE: 'report' | 'strict' = 'report'

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

export interface ProvenanceAuditSummary {
  branchRefs: number
  escapeHatchPairs: number
  matched: number
  orphaned: number
  unprovenanced: number
  unreadable: number
}

/**
 * Tally the verdicts. Every non-`matched` outcome keeps its own counter so the
 * caller can never collapse "could not check" into "checked and fine". Pure.
 */
export function summarizeProvenanceVerdicts(
  verdicts: readonly ReleaseTagProvenanceVerdict[],
): ProvenanceAuditSummary {
  const summary: ProvenanceAuditSummary = {
    branchRefs: 0,
    escapeHatchPairs: 0,
    matched: 0,
    orphaned: 0,
    unprovenanced: 0,
    unreadable: 0,
  }
  for (let i = 0, { length } = verdicts; i < length; i += 1) {
    const verdict = verdicts[i]!
    summary[verdict.kind] += 1
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
 * actually verified and nothing failed OR went unread. Pure.
 */
export function provenanceAuditPassed(
  summary: ProvenanceAuditSummary,
): boolean {
  return (
    summary.matched > 0 &&
    summary.orphaned === 0 &&
    summary.unprovenanced === 0 &&
    summary.unreadable === 0 &&
    (TAG_REF_MODE === 'report' || summary.branchRefs === 0)
  )
}

/**
 * True when the audit must exit non-zero. An unread source is deliberately NOT
 * a failure — it is un-checkable, and an offline CI lane must not go red — but
 * it also never earns the success line above. Pure.
 */
export function provenanceAuditFailed(
  summary: ProvenanceAuditSummary,
): boolean {
  return (
    summary.orphaned > 0 ||
    summary.unprovenanced > 0 ||
    (TAG_REF_MODE === 'strict' && summary.branchRefs > 0)
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
    } else {
      logger.error(formatProvenanceFinding({ name: cfg.name, verdict }))
    }
  }
}

/**
 * Resolve the audit scope from argv: the checkout to read tags from, the
 * package it publishes, and how many versions to cover.
 */
export function parseProvenanceAuditArgs(argv: readonly string[]): {
  all: boolean
  limit: number
  quiet: boolean
  repo: string
  version: string | undefined
} {
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

export async function main(): Promise<void> {
  const args = parseProvenanceAuditArgs(process.argv.slice(2))
  const probe = probeMembership(args.repo)
  if (!probe.member) {
    logger.log(
      `${CHECK_NAME}: ${args.repo} is not a fleet roster member (origin ${probe.originUrl ?? 'absent'}) — nothing asserted.`,
    )
    return
  }
  let name = ''
  try {
    name = resolveNpmWorkspaceLayout(args.repo).versionSource.name
  } catch {
    name = ''
  }
  if (!name) {
    logger.log(
      `${CHECK_NAME}: no publishable npm package here — nothing to assert.`,
    )
    return
  }
  const state = await fetchRegistryReleaseState(name)
  if (!state) {
    logger.log(
      `${CHECK_NAME}: NOT VERIFIED — could not read the ${name} packument (unpublished package / offline lane).`,
    )
    return
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
    return
  }
  const tagStdout = await readOriginTagRefs(args.repo)
  if (tagStdout === undefined) {
    logger.log(
      `${CHECK_NAME}: NOT VERIFIED — origin tags unreadable (no remote / offline lane).`,
    )
    return
  }
  const verdicts = await auditReleaseTagProvenance({
    name,
    readProvenance: fetchAttestedGitSource,
    tagCommits: parseRemoteTagCommits(tagStdout),
    versions: candidates,
  })
  const summary = summarizeProvenanceVerdicts(verdicts)
  if (!args.quiet || !provenanceAuditPassed(summary)) {
    logger.log(`${CHECK_NAME}: ${name}, ${candidates.length} version(s)`)
    reportProvenanceVerdicts({ name, verdicts })
  }
  if (provenanceAuditFailed(summary)) {
    logger.error(
      `[${CHECK_NAME}] ${summary.orphaned} provenance orphan(s), ${summary.unprovenanced} unprovenanced version(s).`,
    )
    process.exitCode = 1
    return
  }
  if (summary.unreadable > 0) {
    logger.warn(
      `${CHECK_NAME}: ${summary.matched}/${candidates.length} verified, ${summary.unreadable} NOT VERIFIED — this run is not a pass.`,
    )
    return
  }
  if (provenanceAuditPassed(summary)) {
    if (!args.quiet) {
      logger.success(
        `${CHECK_NAME}: every audited ${name} version has a release tag at its attested commit (${summary.escapeHatchPairs} escape-hatch pair(s), ${summary.branchRefs} branch-ref attestation(s)).`,
      )
    }
    return
  }
  logger.warn(
    `${CHECK_NAME}: nothing was verified for ${name} — this run is not a pass.`,
  )
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(`${CHECK_NAME} failed: ${errorMessage(e)}`)
    process.exitCode = 1
  })
}
/* c8 ignore stop */
