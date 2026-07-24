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

import { maxVersion } from '@socketsecurity/lib-stable/versions/range'

import {
  renderBullet,
  renderSectionMap,
  SECTION_ORDER,
  TYPE_TO_SECTION,
  unreleasedRange,
} from './changelog-render.mts'

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

export interface ResolveBumpBaseOptions {
  manifestVersion: string
  publishedVersion?: string | undefined
  tagVersion?: string | undefined
}

/**
 * The version a release bumps FROM. Anchored to already-RELEASED authorities —
 * the registry's latest-published version and the last release tag — NEVER to
 * the manifest, which can sit ahead (a hand pre-bump, or a stale
 * `X.Y.Z-prerelease` hint) and would silently SKIP a version: package.json was
 * pre-bumped to 1.4.3, then the release bumped 1.4.3 → 1.4.4, so 1.4.3 was
 * never published. Excluding the manifest from the base means an ahead manifest
 * can never inflate it. Falls back to the manifest core ONLY for a genuine
 * first release (no published version, no tag).
 */
export function resolveBumpBase(config: ResolveBumpBaseOptions): string {
  const cfg = { __proto__: null, ...config } as ResolveBumpBaseOptions
  const released: string[] = []
  if (cfg.publishedVersion) {
    released.push(cfg.publishedVersion)
  }
  if (cfg.tagVersion) {
    released.push(cfg.tagVersion.replace(/^v/, ''))
  }
  return (
    maxVersion(released) ?? cfg.manifestVersion.split('-')[0]!.split('+')[0]!
  )
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
 * Build the Markdown CHANGELOG entry for a version from its commits. Heading
 * matches the fleet shape (`## [X.Y.Z](<repo>/releases/tag/vX.Y.Z) - DATE` when
 * a repo URL is known, else `## X.Y.Z - DATE`); only user-visible commits
 * appear, grouped into Added / Changed / Fixed in that order.
 */
/**
 * The `## <version> - <date>` heading (linked to the release tag when a repo
 * URL is known). One definition, shared by section generation and Unreleased
 * promotion.
 */
export function changelogHeading(
  version: string,
  date: string,
  repoUrl: string | undefined,
): string {
  return repoUrl
    ? `## [${version}](${repoUrl}/releases/tag/v${version}) - ${date}`
    : `## ${version} - ${date}`
}

export function generateChangelogSection(config: {
  commits: readonly ConventionalCommit[]
  date: string
  repoUrl: string | undefined
  version: string
  /**
   * Override the computed `## <version> - <date>` heading. Used to render the
   * accrued `## [Unreleased]` section at squash time.
   */
  heading?: string | undefined
}): string {
  const {
    commits,
    date,
    heading: headingOverride,
    repoUrl,
    version,
  } = {
    __proto__: null,
    ...config,
  } as {
    commits: readonly ConventionalCommit[]
    date: string
    heading?: string | undefined
    repoUrl: string | undefined
    version: string
  }
  const heading = headingOverride ?? changelogHeading(version, date, repoUrl)

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

/**
 * The heading of the accrued, not-yet-released changelog section. Squash-time
 * accrual prepends user-visible entries here; a release promotes it to the
 * version heading.
 */
export const UNRELEASED_HEADING = '## [Unreleased]'

/**
 * True when a generated changelog section carries at least one user-visible
 * entry (a `- ` bullet), vs a bare heading with nothing under it. The empty
 * case is what the release/squash flow stops on (loudly) unless the operator
 * supplies an explicit empty-changelog entry.
 */
export function sectionHasEntries(section: string): boolean {
  return section.split('\n').some(line => /^\s*-\s/u.test(line))
}

/**
 * Append a `### Changed` block with the operator-supplied `bullet` to an
 * otherwise entry-less section, so a release still documents something when the
 * operator explicitly names the entry (bump --empty-changelog-entry "…")
 * instead of authoring real entries under [Unreleased].
 */
export function withChangelogEntry(section: string, bullet: string): string {
  return `${section}\n\n### Changed\n\n- ${bullet}`
}

/**
 * Promote the accrued `## [Unreleased]` section to a released `versionHeading`.
 * Returns the promoted section (heading + the accrued body) and the changelog
 * with the `[Unreleased]` block removed, or undefined when there is no
 * `[Unreleased]` section with entries to promote (so the caller falls back to
 * commit-derivation, then the empty-guard). Pure over its inputs.
 */

/**
 * Parse a changelog section's `### <Section>` blocks into a
 * `{ section -> bullet lines }` map (bullets kept verbatim, already rendered).
 * Pure over its input.
 */
export function parseSectionBullets(section: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  let current: string | undefined
  const lines = section.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    const heading = /^###\s+(.+?)\s*$/u.exec(line)
    if (heading) {
      current = heading[1]!
      if (!out.has(current)) {
        out.set(current, [])
      }
      continue
    }
    if (current && /^\s*-\s/u.test(line)) {
      out.get(current)!.push(line.trim())
    }
  }
  return out
}

/**
 * Merge a freshly-generated `entriesSection` (from generateChangelogSection)
 * into the changelog's `## [Unreleased]` block — creating it above the first
 * version heading when absent — newest entries first, deduping identical
 * bullets. Squash-time accrual calls this so user-visible entries survive the
 * collapse and accumulate across squashes until a release promotes them. A
 * no-entry `entriesSection` returns the changelog unchanged. Pure over inputs.
 */
export function mergeUnreleased(
  changelog: string,
  entriesSection: string,
): string {
  const incoming = parseSectionBullets(entriesSection)
  let incomingCount = 0
  for (const bullets of incoming.values()) {
    incomingCount += bullets.length
  }
  if (incomingCount === 0) {
    return changelog
  }
  const lines = changelog.split('\n')
  const range = unreleasedRange(lines, UNRELEASED_HEADING)
  let before: string[]
  let after: string[]
  let existingBody = ''
  if (!range) {
    const firstVersion = lines.findIndex(l => l.startsWith('## '))
    if (firstVersion === -1) {
      before = lines
      after = []
    } else {
      before = lines.slice(0, firstVersion)
      after = lines.slice(firstVersion)
    }
  } else {
    existingBody = lines.slice(range.start + 1, range.end).join('\n')
    before = lines.slice(0, range.start)
    after = lines.slice(range.end)
  }
  // Incoming (newest) first, then the existing accrued bullets, deduped.
  const merged = new Map<string, string[]>()
  for (const [section, bullets] of incoming) {
    merged.set(section, [...bullets])
  }
  for (const [section, bullets] of parseSectionBullets(existingBody)) {
    const arr = merged.get(section) ?? []
    for (const bullet of bullets) {
      if (!arr.includes(bullet)) {
        arr.push(bullet)
      }
    }
    merged.set(section, arr)
  }
  const block = renderSectionMap(UNRELEASED_HEADING, merged)
  const beforeText = before.join('\n').replace(/\s*$/u, '')
  const afterText = after.join('\n').replace(/^\s*/u, '')
  return `${beforeText}\n\n${block}\n\n${afterText}`
    .replace(/\n{3,}/gu, '\n\n')
    .replace(/\s+$/u, '\n')
}

export function promoteUnreleased(
  changelog: string,
  versionHeading: string,
): { changelog: string; section: string } | undefined {
  const lines = changelog.split('\n')
  const range = unreleasedRange(lines, UNRELEASED_HEADING)
  if (!range) {
    return undefined
  }
  const body = lines
    .slice(range.start + 1, range.end)
    .join('\n')
    .trim()
  if (!sectionHasEntries(body)) {
    return undefined
  }
  const remainder = [...lines.slice(0, range.start), ...lines.slice(range.end)]
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .replace(/\s+$/u, '\n')
  return { changelog: remainder, section: `${versionHeading}\n\n${body}` }
}
