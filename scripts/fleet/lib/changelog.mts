/**
 * @file Derive the next version and generate the CHANGELOG section from the
 *   Conventional Commits being released. The release CHANGELOG is a DERIVED
 *   artifact — computed from the commits between the last release tag and HEAD,
 *   never hand-written — so it can't drift ahead of (or behind) the tag the way
 *   a hand-edited entry can. `bump.mts` calls these to write the entry; the
 *   `changelog-is-generated` guard blocks hand-edits so the derivation stays
 *   the single source of truth. Conventional Commits 1.0: `<type>[(scope)][!]:
 *   <description>`. A `!` before the colon, or a `BREAKING CHANGE:` line in the
 *   body, marks a breaking change. Only user-visible types reach the CHANGELOG
 *   (feat / fix / perf / revert); chore / ci / docs / test / style / build /
 *   refactor are omitted because the CHANGELOG records user-visible behavior,
 *   not internal churn.
 */

// Record separator between commits, unit separator between fields — both
// control chars that never appear in a commit subject/body, so a `git log
// --format=%H%x1f%s%x1f%b%x1e` stream parses unambiguously.
export const COMMIT_FIELD_SEP = '\x1f'
export const COMMIT_RECORD_SEP = '\x1e'

// The `git log --format` string that produces a parseable stream for
// `parseConventionalCommits`. Kept here so the producer (bump.mts / the guard)
// and the parser can never disagree on the shape.
export const COMMIT_LOG_FORMAT = `%H${COMMIT_FIELD_SEP}%s${COMMIT_FIELD_SEP}%b${COMMIT_RECORD_SEP}`

export type BumpLevel = 'major' | 'minor' | 'patch'

export interface ConventionalCommit {
  breaking: boolean
  description: string
  hash: string
  scope: string | undefined
  type: string
}

// User-visible commit types → the Keep a Changelog section each lands under.
// A type absent from this map is internal churn and never reaches the CHANGELOG.
const TYPE_TO_SECTION: Record<string, string> = {
  __proto__: null,
  feat: 'Added',
  fix: 'Fixed',
  perf: 'Changed',
  revert: 'Changed',
} as unknown as Record<string, string>

// Section display order in the generated entry.
const SECTION_ORDER: readonly string[] = ['Added', 'Changed', 'Fixed']

const SUBJECT_RE =
  /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<bang>!)?:\s*(?<description>.+)$/

/**
 * Parse one `<type>(<scope>)!: <description>` subject plus its body into a
 * `ConventionalCommit`. Returns `undefined` for a subject that isn't
 * Conventional-Commit-shaped (merge commits, ad-hoc messages) so the caller can
 * skip it.
 */
export function parseCommit(
  hash: string,
  subject: string,
  body: string,
): ConventionalCommit | undefined {
  const m = SUBJECT_RE.exec(subject.trim())
  if (!m?.groups) {
    return undefined
  }
  const { bang, description, scope, type } = m.groups
  const breaking = bang === '!' || /^BREAKING CHANGE:/m.test(body)
  return {
    breaking,
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
  const out: ConventionalCommit[] = []
  const records = raw.split(COMMIT_RECORD_SEP)
  for (let i = 0, { length } = records; i < length; i += 1) {
    const record = records[i]!.trim()
    if (!record) {
      continue
    }
    const [hash, subject, body] = record.split(COMMIT_FIELD_SEP)
    const commit = parseCommit(hash ?? '', subject ?? '', body ?? '')
    if (commit) {
      out.push(commit)
    }
  }
  return out
}

/**
 * The semver bump a commit set requires: a breaking change forces major, else a
 * feature forces minor, else a fix/perf forces patch. Returns `undefined` when
 * nothing user-visible landed — the caller decides whether to refuse the
 * release or force a patch.
 */
export function bumpLevelFor(
  commits: readonly ConventionalCommit[],
): BumpLevel | undefined {
  let hasFeature = false
  let hasPatchable = false
  for (let i = 0, { length } = commits; i < length; i += 1) {
    const c = commits[i]!
    if (c.breaking) {
      return 'major'
    }
    if (c.type === 'feat') {
      hasFeature = true
    } else if (c.type === 'fix' || c.type === 'perf' || c.type === 'revert') {
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
 * A committed version HINT: when package.json's version carries a prerelease
 * suffix (`6.0.10-prerelease`, `6.0.10-rc.1`), the base version IS the
 * human-named release target — the bump uses it instead of the commit-type
 * heuristic. A plain release version (no suffix) yields undefined (derive as
 * usual). This lets a human pre-commit the version decision as a repo
 * artifact instead of threading a flag.
 */
export function versionHintFrom(current: string): string | undefined {
  const dash = current.indexOf('-')
  if (dash === -1) {
    return undefined
  }
  const base = current.slice(0, dash).split('+')[0]!
  return /^\d+\.\d+\.\d+$/.test(base) ? base : undefined
}

/**
 * Apply a bump level to a semver `MAJOR.MINOR.PATCH` string. Any prerelease /
 * build suffix is dropped (a release bump produces a clean release version).
 */
export function computeNextVersion(current: string, level: BumpLevel): string {
  const core = current.split('-')[0]!.split('+')[0]!
  const parts = core.split('.').map(n => Number.parseInt(n, 10))
  const major = parts[0] ?? 0
  const minor = parts[1] ?? 0
  const patch = parts[2] ?? 0
  if (level === 'major') {
    return `${major + 1}.0.0`
  }
  if (level === 'minor') {
    return `${major}.${minor + 1}.0`
  }
  return `${major}.${minor}.${patch + 1}`
}

/**
 * Normalize a package.json `repository.url`
 * (`git+https://github.com/Org/Repo.git`, `git@github.com:Org/Repo.git`, …) to
 * a plain `https://github.com/Org/Repo` base, or `undefined` when it can't.
 * Used to link the version heading to its release.
 */
export function repoBaseUrl(
  repositoryUrl: string | undefined,
): string | undefined {
  if (!repositoryUrl) {
    return undefined
  }
  const m = /github\.com[/:](?<owner>[^/]+)\/(?<repo>[^/.]+)/.exec(
    repositoryUrl,
  )
  if (!m?.groups) {
    return undefined
  }
  return `https://github.com/${m.groups['owner']}/${m.groups['repo']}`
}

/**
 * Render one bullet for a commit: a bold scope prefix when present, the
 * description, and a `**BREAKING:**` marker for breaking changes.
 */
function renderBullet(commit: ConventionalCommit): string {
  const breaking = commit.breaking ? '**BREAKING:** ' : ''
  const scope = commit.scope ? `**\`${commit.scope}\`** — ` : ''
  return `- ${breaking}${scope}${commit.description}`
}

/**
 * Build the Markdown CHANGELOG entry for a version from its commits. Heading
 * matches the fleet shape (`## [X.Y.Z](<repo>/releases/tag/vX.Y.Z) - DATE` when
 * a repo URL is known, else `## X.Y.Z - DATE`); only user-visible commits
 * appear, grouped into Added / Changed / Fixed in that order.
 */
export function generateChangelogSection(options: {
  commits: readonly ConventionalCommit[]
  date: string
  repoUrl: string | undefined
  version: string
}): string {
  const { commits, date, repoUrl, version } = {
    __proto__: null,
    ...options,
  } as {
    commits: readonly ConventionalCommit[]
    date: string
    repoUrl: string | undefined
    version: string
  }
  const heading = repoUrl
    ? `## [${version}](${repoUrl}/releases/tag/v${version}) - ${date}`
    : `## ${version} - ${date}`

  const bySection = new Map<string, string[]>()
  for (let i = 0, { length } = commits; i < length; i += 1) {
    const commit = commits[i]!
    // A breaking commit is user-visible whatever its type — an unmapped type
    // (refactor!, chore!) still lands, under Changed, so a `!` can never
    // vanish from the CHANGELOG.
    const section =
      TYPE_TO_SECTION[commit.type] ?? (commit.breaking ? 'Changed' : undefined)
    if (!section) {
      continue
    }
    const bullets = bySection.get(section) ?? []
    bullets.push(renderBullet(commit))
    bySection.set(section, bullets)
  }

  const blocks: string[] = [heading]
  for (let i = 0, { length } = SECTION_ORDER; i < length; i += 1) {
    const section = SECTION_ORDER[i]!
    const bullets = bySection.get(section)
    if (bullets && bullets.length > 0) {
      blocks.push(`### ${section}\n\n${bullets.join('\n')}`)
    }
  }
  return blocks.join('\n\n')
}
