/**
 * @file Derive the next release version from the Conventional Commits landed
 *   since the last release. Everything here is PURE over its inputs — no git,
 *   no registry, no filesystem — so `bump.mts` collects the facts and this
 *   module decides the number. That split is what makes the decision unit
 *   testable.
 *
 *   The base a release bumps FROM is anchored to already-CONSUMED authorities:
 *   the version npm serves as `latest`, and every `v<semver>` git tag in the
 *   repo. The manifest is deliberately NOT an authority — it can sit ahead of
 *   reality (a hand pre-bump) and would silently skip a number.
 *
 *   BURNED VERSIONS. A run that cuts the tag and stages the tarballs but is
 *   never approved leaves a tag with nothing on npm behind it. That number is
 *   spent and must never be re-published. Because the tag set is an authority
 *   here, a burned number moves the base forward on its own: with npm `latest`
 *   at 1.1.153 and a burned tag `v1.1.154`, the base is 1.1.154 and the next
 *   patch is 1.1.155.
 */

import semver from 'semver'

export type BumpLevel = 'major' | 'minor' | 'patch'

export interface ConventionalCommit {
  readonly breaking: boolean
  readonly description: string
  readonly hash: string
  readonly scope: string | undefined
  readonly type: string
}

// Record separator between commits, unit separator between fields. Both are
// control characters that never appear in a commit subject or body, so a
// `git log --format=...` stream parses unambiguously even when a body contains
// blank lines or its own newlines.
export const COMMIT_FIELD_SEP = '\x1f'
export const COMMIT_RECORD_SEP = '\x1e'

// The `git log --format` string that produces a stream `parseConventionalCommits`
// can read. Kept beside the parser so the producer and the consumer cannot
// disagree on the shape.
export const COMMIT_LOG_FORMAT = `%H${COMMIT_FIELD_SEP}%s${COMMIT_FIELD_SEP}%b${COMMIT_RECORD_SEP}`

// Conventional Commits 1.0: `<type>[(scope)][!]: <description>`.
const SUBJECT_RE =
  /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<bang>!)?:\s*(?<description>.+)$/

/**
 * Parse one commit subject plus its body into a `ConventionalCommit`. Returns
 * undefined for a subject that is not Conventional-Commit shaped — a merge
 * commit, an ad-hoc message — so the caller can skip it.
 */
export function parseConventionalCommit(
  hash: string,
  subject: string,
  body: string,
): ConventionalCommit | undefined {
  const match = SUBJECT_RE.exec(subject.trim())
  if (!match?.groups) {
    return undefined
  }
  const { bang, description, scope, type } = match.groups
  return {
    breaking: bang === '!' || /^BREAKING CHANGE:/m.test(body),
    description: description!.trim(),
    hash,
    scope: scope ? scope.trim() : undefined,
    type: type!,
  }
}

/**
 * Parse a `git log --format=COMMIT_LOG_FORMAT` stream into commits, newest
 * first (git's default order). Non-conforming subjects are dropped.
 */
export function parseConventionalCommits(raw: string): ConventionalCommit[] {
  const commits: ConventionalCommit[] = []
  const records = raw.split(COMMIT_RECORD_SEP)
  for (let i = 0, { length } = records; i < length; i += 1) {
    const record = records[i]!.trim()
    if (!record) {
      continue
    }
    const [hash, subject, body] = record.split(COMMIT_FIELD_SEP)
    const commit = parseConventionalCommit(
      hash ?? '',
      subject ?? '',
      body ?? '',
    )
    if (commit) {
      commits.push(commit)
    }
  }
  return commits
}

/**
 * The semver level a commit set requires: a breaking change forces major, else
 * a feature forces minor, else a fix/perf/revert forces patch. Returns
 * undefined when nothing user-visible landed — the caller decides what to do
 * with a release that only carries internal churn.
 */
export function bumpLevelFor(
  commits: readonly ConventionalCommit[],
): BumpLevel | undefined {
  let hasFeature = false
  let hasPatchable = false
  for (let i = 0, { length } = commits; i < length; i += 1) {
    const commit = commits[i]!
    if (commit.breaking) {
      return 'major'
    }
    if (commit.type === 'feat') {
      hasFeature = true
    } else if (
      commit.type === 'fix' ||
      commit.type === 'perf' ||
      commit.type === 'revert'
    ) {
      hasPatchable = true
    }
  }
  if (hasFeature) {
    return 'minor'
  }
  if (hasPatchable) {
    return 'patch'
  }
  return undefined
}

/**
 * The highest release version among `versions`. A leading `v` is tolerated so
 * raw tag names can be passed straight through, and anything unparseable or
 * carrying a prerelease suffix is ignored — only shipped releases anchor a
 * base.
 */
export function maxReleaseVersion(
  versions: readonly string[],
): string | undefined {
  let best: string | undefined
  for (let i = 0, { length } = versions; i < length; i += 1) {
    const cleaned = semver.valid(semver.clean(versions[i]!) ?? '')
    if (!cleaned || semver.prerelease(cleaned)) {
      continue
    }
    if (!best || semver.gt(cleaned, best)) {
      best = cleaned
    }
  }
  return best
}

export interface BumpBaseConfig {
  readonly manifestVersion: string
  readonly publishedVersion?: string | undefined
  // Release tags belonging to THIS line, i.e. reachable from HEAD. Passing the
  // repo's whole tag set is a bug: socket-cli carries the 1.x and 2.x lines in
  // one repository, so an unfiltered max on the v1.x branch resolves to a 2.x
  // tag and the next "patch" lands on the wrong line entirely.
  readonly tagVersions?: readonly string[] | undefined
}

/**
 * The version a release bumps FROM. Anchored to the consumed authorities — the
 * release tags on this line and the registry's `latest` — never to the manifest,
 * which can sit ahead of both and would make the release skip a number. Falls
 * back to the manifest core only for a genuine first release, where neither
 * authority has anything to say.
 *
 * The registry's `latest` is a repo-wide signal, not a per-line one, so it only
 * counts when it shares a major with this line's newest tag. That keeps a
 * maintenance branch anchored to its own line even while a newer major owns the
 * dist-tag, and still lets `latest` cover a release whose tag went missing.
 */
export function resolveBumpBase(config: BumpBaseConfig): string {
  const cfg = { __proto__: null, ...config } as BumpBaseConfig
  const tagMax = maxReleaseVersion(cfg.tagVersions ?? [])
  const published = maxReleaseVersion(
    cfg.publishedVersion ? [cfg.publishedVersion] : [],
  )
  const sameLine =
    published && (!tagMax || semver.major(published) === semver.major(tagMax))
      ? [published]
      : []
  return (
    maxReleaseVersion([...(tagMax ? [tagMax] : []), ...sameLine]) ??
    semver.valid(semver.coerce(cfg.manifestVersion) ?? '') ??
    '0.0.0'
  )
}

export interface DeriveNextVersionConfig {
  readonly commits: readonly ConventionalCommit[]
  readonly manifestVersion: string
  readonly publishedVersion?: string | undefined
  readonly releaseAs?: string | undefined
  readonly tagVersions?: readonly string[] | undefined
}

export interface DerivedVersion {
  // The already-consumed version the bump starts from.
  readonly base: string
  // The level applied to `base`.
  readonly level: BumpLevel
  // Why the level was chosen, for the run log.
  readonly reason: string
  // The version this release ships.
  readonly version: string
}

/**
 * Decide the version this release ships.
 *
 * PATCH BY DEFAULT. A commit set with no user-visible commits still releases —
 * as a patch — because the dispatch itself is the operator saying "ship what is
 * on this branch". Only `releaseAs` can force a level upward, and MAJOR is
 * never derived: a `feat!:` or a `BREAKING CHANGE:` body reports major here, so
 * the caller can refuse and make a human name it.
 */
export function deriveNextVersion(
  config: DeriveNextVersionConfig,
): DerivedVersion {
  const cfg = { __proto__: null, ...config } as DeriveNextVersionConfig
  const base = resolveBumpBase({
    manifestVersion: cfg.manifestVersion,
    publishedVersion: cfg.publishedVersion,
    tagVersions: cfg.tagVersions,
  })
  const forced = cfg.releaseAs?.trim()
  if (forced) {
    if (forced !== 'major' && forced !== 'minor' && forced !== 'patch') {
      throw new Error(
        `[version] release-as must be major, minor, or patch (got "${forced}").\n` +
          `  Where: the npm-publish dispatch's release-as input.\n` +
          `  Saw: "${forced}"; wanted one of major | minor | patch, or empty to derive.\n` +
          `  Fix: re-dispatch with one of the three levels, or leave it empty.`,
      )
    }
    return {
      base,
      level: forced,
      reason: `forced to ${forced} by the release-as input`,
      version: semver.inc(base, forced)!,
    }
  }
  const derived = bumpLevelFor(cfg.commits)
  const level = derived ?? 'patch'
  const reason = derived
    ? `derived ${derived} from ${cfg.commits.length} conventional commit(s) since ${base}`
    : `no user-visible commits since ${base} — patch by default`
  return { base, level, reason, version: semver.inc(base, level)! }
}
