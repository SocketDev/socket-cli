/**
 * @file The changelog RANGE ANCHOR chain, registry-agnostic. A release's
 *   CHANGELOG section is derived from the commits since the LAST RELEASED
 *   version, and the range anchor must resolve through a strict chain that
 *   never silently widens to an older tag: the previous release's own tag →
 *   the commit that flipped the manifest version to it → the registry's
 *   publish time for it, else a hard stop. The npm lane (bump.mts) and the
 *   cargo lane (publish-infra/cargo/bump.mts) both bind this ONE
 *   implementation through a `ReleaseLane` adapter — the lanes differ only in
 *   which manifest carries the version (package.json vs Cargo.toml) and which
 *   registry holds the publish ledger (npmjs vs crates.io) — so the anchor
 *   semantics cannot fork per registry. The regression under guard: socket-lib
 *   6.2.2's changelog re-listed the shipped 6.2.1 fix because the missing
 *   v6.2.1 tag silently widened the range to v6.2.0.
 */

import {
  COMMIT_LOG_FORMAT,
  parseConventionalCommits,
  resolveBumpBase,
} from './changelog.mts'
import { REPO_ROOT } from '../paths.mts'
import { runCapture } from '../publish-infra/shared.mts'

import type { ConventionalCommit } from './changelog.mts'

/**
 * A registry latest-version read that distinguishes "the registry answered:
 * never published" from "the registry could not be consulted". The derivation
 * hard-stops on `reachable: false` — offline, `git describe` may be resolving
 * an OLDER tag while the newest release's tag is missing, and trusting local
 * state alone silently widens the changelog range.
 */
export type RegistryLatestRead =
  | { latest: string | undefined; reachable: true }
  | { reachable: false }

/**
 * What a release lane (npm, cargo) plugs into the anchor chain: where its
 * version lives and how its registry answers.
 */
export interface ReleaseLane {
  /**
   * The registry's latest published version, or the explicit unreachable
   * signal. `reachable: true, latest: undefined` means the registry answered
   * and the package was never published — a genuine first release.
   */
  fetchLatest(): Promise<RegistryLatestRead>
  /**
   * The registry's publish timestamp for `version` as an ISO 8601 string, or
   * undefined when unknown. The last anchor link, used only when both the tag
   * and the version-flip commit are unrecoverable.
   */
  fetchPublishedAt(version: string): Promise<string | undefined>
  /**
   * Repo-relative path of the manifest whose version flip marks a release —
   * package.json for npm, the version-carrying Cargo.toml for cargo. The
   * bump-commit anchor link probes this file's history.
   */
  manifestPath: string
  /**
   * The manifest's version parsed from its text at some ref, or undefined
   * when the text doesn't parse or carries no version.
   */
  parseManifestVersion(text: string): string | undefined
}

/**
 * Where the changelog derivation starts reading commits — always anchored to
 * the LAST RELEASED version, resolved through a strict chain that never
 * silently widens to an older tag:
 *
 * 1. `tag` — the previous release's own `v<version>` tag (when it exists AND is an
 *    ancestor of HEAD);
 * 2. `bump-commit` — the commit that flipped the manifest's `version` to the
 *    previous released version (the release's bump commit), when the tag was
 *    never pushed;
 * 3. `published-at` — the registry's publish timestamp for the previous version as
 *    a `--since` bound, when even the bump commit is gone (history rewrite);
 * 4. `first-release` — no prior release at all: all history is the changelog.
 *
 * A previous release whose anchor can't be resolved by ANY link is a hard
 * stop for the bump (and a fail-open skip for the drift check) — falling back
 * to an older tag would re-list already-shipped commits.
 */
export type ReleaseAnchor =
  | { kind: 'first-release' }
  | { kind: 'tag'; ref: string; version: string }
  | { kind: 'bump-commit'; ref: string; version: string }
  | { kind: 'published-at'; since: string; version: string }

/**
 * Resolve the most recent REACHABLE `v<semver>` release tag, or `undefined`
 * for a repo with no release tags yet (first release — all history is the
 * changelog). NOTE: `git describe` walks ancestry, so when the newest
 * release's tag is missing this resolves an OLDER tag — never use its result
 * directly as the changelog range anchor (that re-lists already-shipped
 * commits, the socket-lib 6.2.2 failure). `resolveReleaseAnchor` owns the
 * anchor; this feeds `resolveBumpBase` and pending-release detection only.
 */
export async function lastReleaseTag(
  cwd: string = REPO_ROOT,
): Promise<string | undefined> {
  const r = await runCapture(
    'git',
    ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*'],
    cwd,
  )
  const tag = r.stdout.trim()
  return r.code === 0 && tag ? tag : undefined
}

/**
 * The lane manifest's `version` at a git `ref`, or `undefined` when the ref /
 * file / parse is unavailable (e.g. the parent of a root commit).
 */
async function manifestVersionAt(
  lane: ReleaseLane,
  ref: string,
  cwd: string,
): Promise<string | undefined> {
  const r = await runCapture(
    'git',
    ['show', `${ref}:${lane.manifestPath}`],
    cwd,
  )
  if (r.code !== 0) {
    return undefined
  }
  return lane.parseManifestVersion(r.stdout)
}

/**
 * The commit that FLIPPED the lane manifest's `version` to `version` — the
 * release's bump commit — or `undefined` when no such commit is reachable
 * from HEAD. `git log -S` finds every commit changing the count of
 * `"<version>"` occurrences in the manifest (the bump itself, the next bump
 * that removed it, dependency pins); each candidate is verified by reading
 * the manifest at the commit (must read `version`) and at its parent (must
 * not), so only the true flip qualifies. The quoted probe matches both JSON
 * (`"version": "X"`) and TOML (`version = "X"`) version lines.
 */
export async function findVersionFlipCommit(
  lane: ReleaseLane,
  version: string,
  cwd: string = REPO_ROOT,
): Promise<string | undefined> {
  const r = await runCapture(
    'git',
    ['log', '--format=%H', '-S', `"${version}"`, '--', lane.manifestPath],
    cwd,
  )
  if (r.code !== 0) {
    return undefined
  }
  const hashes = r.stdout.split('\n')
  for (let i = 0, { length } = hashes; i < length; i += 1) {
    const hash = hashes[i]!.trim()
    if (!hash) {
      continue
    }
    if ((await manifestVersionAt(lane, hash, cwd)) !== version) {
      continue
    }
    if ((await manifestVersionAt(lane, `${hash}^`, cwd)) !== version) {
      return hash
    }
  }
  return undefined
}

/**
 * Resolve the changelog range anchor for the previous released version via
 * the strict chain documented on `ReleaseAnchor`. Returns `undefined` when a
 * previous release exists but no anchor link resolves — the caller must stop
 * (bump) or skip (drift check), NEVER widen to an older tag.
 */
export async function resolveReleaseAnchor(config: {
  cwd?: string | undefined
  lane: ReleaseLane
  prevVersion: string | undefined
}): Promise<ReleaseAnchor | undefined> {
  const {
    cwd = REPO_ROOT,
    lane,
    prevVersion,
  } = {
    __proto__: null,
    ...config,
  } as {
    cwd?: string | undefined
    lane: ReleaseLane
    prevVersion: string | undefined
  }
  if (!prevVersion) {
    return { kind: 'first-release' }
  }
  const tag = `v${prevVersion}`
  const tagListed = await runCapture('git', ['tag', '-l', tag], cwd)
  if (tagListed.code === 0 && tagListed.stdout.trim() === tag) {
    // The tag must be on HEAD's lineage: after a history rewrite an
    // off-lineage tag makes `tag..HEAD` span the whole rewritten history.
    const ancestor = await runCapture(
      'git',
      ['merge-base', '--is-ancestor', tag, 'HEAD'],
      cwd,
    )
    if (ancestor.code === 0) {
      return { kind: 'tag', ref: tag, version: prevVersion }
    }
  }
  const flip = await findVersionFlipCommit(lane, prevVersion, cwd)
  if (flip) {
    return { kind: 'bump-commit', ref: flip, version: prevVersion }
  }
  const publishedAt = await lane.fetchPublishedAt(prevVersion)
  if (publishedAt) {
    return { kind: 'published-at', since: publishedAt, version: prevVersion }
  }
  return undefined
}

/**
 * Human-readable description of an anchor for log/error messages.
 */
export function describeAnchor(anchor: ReleaseAnchor): string {
  if (anchor.kind === 'tag') {
    return `tag ${anchor.ref}`
  }
  if (anchor.kind === 'bump-commit') {
    return `the ${anchor.version} bump commit (${anchor.ref.slice(0, 12)})`
  }
  if (anchor.kind === 'published-at') {
    return `the ${anchor.version} registry publish time (${anchor.since})`
  }
  return 'the start of history'
}

/**
 * Read the commit stream from `anchor` (exclusive) to HEAD in the parseable
 * `COMMIT_LOG_FORMAT`. A `published-at` anchor bounds by commit date
 * (`--since`) — an approximation used only when both the tag and the bump
 * commit are unrecoverable.
 */
export async function readCommitStream(
  anchor: ReleaseAnchor,
  cwd: string = REPO_ROOT,
): Promise<string> {
  const args = ['log', `--format=${COMMIT_LOG_FORMAT}`]
  if (anchor.kind === 'bump-commit' || anchor.kind === 'tag') {
    args.push(`${anchor.ref}..HEAD`)
  } else if (anchor.kind === 'published-at') {
    args.push(`--since=${anchor.since}`, 'HEAD')
  } else {
    args.push('HEAD')
  }
  const r = await runCapture('git', args, cwd)
  return r.code === 0 ? r.stdout : ''
}

/**
 * Everything a release derives from the repo + registry, resolved ONCE.
 */
export interface ReleaseDerivation {
  anchor: ReleaseAnchor
  /**
   * The last RELEASED version (registry latest + last reachable tag).
   */
  base: string
  commits: ConventionalCommit[]
  fromTag: string | undefined
  publishedVersion: string | undefined
}

/**
 * THE single derivation code path for a release's commit set — each lane's
 * generator and verifier bind it with the same `ReleaseLane`, so the
 * CHANGELOG a bump writes and the CHANGELOG a drift check expects can never
 * disagree: same base, same anchor chain, same commit stream, same parser.
 * Returns `undefined` when a previous release exists but no anchor resolves
 * (see `resolveReleaseAnchor`) — or when the registry is UNREACHABLE: offline,
 * the true latest release is unknowable, and `git describe` may be resolving
 * an older tag whose newer sibling is missing, so anchoring on local state
 * alone would silently widen the range. Never widen; refuse.
 */
export async function deriveReleaseCommits(config: {
  cwd?: string | undefined
  lane: ReleaseLane
  manifestVersion: string
}): Promise<ReleaseDerivation | undefined> {
  const {
    cwd = REPO_ROOT,
    lane,
    manifestVersion,
  } = {
    __proto__: null,
    ...config,
  } as {
    cwd?: string | undefined
    lane: ReleaseLane
    manifestVersion: string
  }
  const fromTag = await lastReleaseTag(cwd)
  const latestRead = await lane.fetchLatest()
  if (!latestRead.reachable) {
    return undefined
  }
  const publishedVersion = latestRead.latest
  const base = resolveBumpBase({
    manifestVersion,
    publishedVersion,
    tagVersion: fromTag,
  })
  // A prior release exists when the registry or the tag namespace says so;
  // only then is `base` a released version to anchor on.
  const prevVersion = publishedVersion || fromTag ? base : undefined
  const anchor = await resolveReleaseAnchor({
    cwd,
    lane,
    prevVersion,
  })
  if (!anchor) {
    return undefined
  }
  const commits = parseConventionalCommits(await readCommitStream(anchor, cwd))
  return { anchor, base, commits, fromTag, publishedVersion }
}
