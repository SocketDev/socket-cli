/**
 * @file Write the release section into CHANGELOG.md in this repo's Keep a
 *   Changelog shape — `## [X.Y.Z](<repo>/releases/tag/vX.Y.Z) - YYYY-MM-DD`,
 *   then `### Added` / `### Changed` / `### Fixed` blocks. Pure over its inputs:
 *   the caller reads the file, calls `promoteChangelog`, and writes the result.
 *
 *   TWO SOURCES, ONE WINNER. Notes accrue by hand under `## [Unreleased]` in the
 *   repo's marketing voice, which is what this changelog is for. A release
 *   PROMOTES that block verbatim under the new version heading. Only when
 *   `[Unreleased]` is absent or empty does the commit-derived section stand in,
 *   so a release always documents something and a hand-written note is never
 *   silently replaced by a raw commit subject.
 */

import type { ConventionalCommit } from './version.mts'

export const UNRELEASED_HEADING = '## [Unreleased]'

// User-visible commit types → the Keep a Changelog section each lands under. A
// type absent from this map is internal churn and never reaches the changelog,
// matching the repo's "exclude internal changes" rule.
const TYPE_TO_SECTION = new Map<string, string>([
  ['feat', 'Added'],
  ['fix', 'Fixed'],
  ['perf', 'Changed'],
  ['revert', 'Changed'],
])

// Section display order in a generated entry.
const SECTION_ORDER: readonly string[] = [
  'Added',
  'Changed',
  'Fixed',
  'Removed',
]

/**
 * Normalize a package.json `repository.url` (`git+https://github.com/Org/Repo.git`,
 * `git@github.com:Org/Repo.git`) to a plain `https://github.com/Org/Repo`, or
 * undefined when it cannot. Used to link the version heading to its release.
 */
export function repoBaseUrl(
  repositoryUrl: string | undefined,
): string | undefined {
  if (!repositoryUrl) {
    return undefined
  }
  const match = /github\.com[/:](?<owner>[^/]+)\/(?<repo>[^/.]+)/.exec(
    repositoryUrl,
  )
  if (!match?.groups) {
    return undefined
  }
  return `https://github.com/${match.groups['owner']}/${match.groups['repo']}`
}

/**
 * The `## [X.Y.Z](<repo>/releases/tag/vX.Y.Z) - DATE` heading this repo uses, so
 * a reader can click the version to reach the matching GitHub release. Falls
 * back to an unlinked heading when the repository URL is unknown.
 */
export function changelogHeading(
  version: string,
  date: string,
  repoUrl: string | undefined,
): string {
  return repoUrl
    ? `## [${version}](${repoUrl}/releases/tag/v${version}) - ${date}`
    : `## [${version}] - ${date}`
}

function escapeMarkdownProse(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/[\\`*_]/gu, '\\$&')
}

/**
 * Render one bullet for a commit: a bold scope prefix when present, then the
 * description. A breaking change is emphasized rather than labelled, so the
 * reader's eye lands on what changed.
 */
export function renderBullet(commit: ConventionalCommit): string {
  const scope = commit.scope ? `**\`${commit.scope}\`** — ` : ''
  const description = escapeMarkdownProse(commit.description)
  return `- ${scope}${commit.breaking ? `_${description}_` : description}`
}

/**
 * Render a `{ section -> bullets }` map under `heading`, standard sections in
 * canonical order first, then any others. Empty sections are omitted. The
 * bullet list hugs its `###` heading with no blank line between, matching every
 * existing entry in this repo's changelog.
 */
export function renderSectionMap(
  heading: string,
  bySection: ReadonlyMap<string, readonly string[]>,
): string {
  const blocks: string[] = [heading]
  const emit = (section: string): void => {
    const bullets = bySection.get(section)
    if (bullets && bullets.length > 0) {
      blocks.push(`### ${section}\n${bullets.join('\n')}`)
    }
  }
  for (let i = 0, { length } = SECTION_ORDER; i < length; i += 1) {
    emit(SECTION_ORDER[i]!)
  }
  for (const section of bySection.keys()) {
    if (!SECTION_ORDER.includes(section)) {
      emit(section)
    }
  }
  return blocks.join('\n\n')
}

export interface GenerateSectionConfig {
  readonly commits: readonly ConventionalCommit[]
  readonly heading: string
}

/**
 * Build the changelog body for a version from its commits. Only user-visible
 * commits appear; a breaking commit lands under Changed whatever its type, so a
 * `!` can never vanish from the changelog. Returns the heading alone when
 * nothing user-visible landed.
 */
export function generateChangelogSection(
  config: GenerateSectionConfig,
): string {
  const cfg = { __proto__: null, ...config } as GenerateSectionConfig
  const bySection = new Map<string, string[]>()
  for (let i = 0, { length } = cfg.commits; i < length; i += 1) {
    const commit = cfg.commits[i]!
    const section =
      TYPE_TO_SECTION.get(commit.type) ??
      (commit.breaking ? 'Changed' : undefined)
    if (!section) {
      continue
    }
    const bullets = bySection.get(section) ?? []
    bullets.push(renderBullet(commit))
    bySection.set(section, bullets)
  }
  return renderSectionMap(cfg.heading, bySection)
}

/**
 * True when a rendered section carries at least one `- ` bullet, as opposed to
 * a bare heading with nothing under it.
 */
export function sectionHasEntries(section: string): boolean {
  return section.split('\n').some(line => /^\s*-\s/u.test(line))
}

/**
 * The `[start, end)` line range of the `## [Unreleased]` block (heading at
 * `start`, `end` at the next `## ` heading or EOF), or undefined when there is
 * no such heading. The match is case-insensitive: the heading is hand-authored
 * as often as it is generated, and an exact match silently promoted nothing
 * when someone wrote `## [unreleased]`.
 */
export function unreleasedRange(
  lines: readonly string[],
): { end: number; start: number } | undefined {
  const wanted = UNRELEASED_HEADING.toLowerCase()
  const start = lines.findIndex(line => line.trim().toLowerCase() === wanted)
  if (start === -1) {
    return undefined
  }
  let end = lines.length
  for (let i = start + 1, { length } = lines; i < length; i += 1) {
    if (lines[i]!.startsWith('## ')) {
      end = i
      break
    }
  }
  return { end, start }
}

export interface PromoteChangelogConfig {
  readonly changelog: string
  readonly derivedSection: string
  readonly heading: string
}

export interface PromotedChangelog {
  // The whole CHANGELOG.md text with the release section inserted.
  readonly changelog: string
  // Where the released bullets came from, for the run log.
  readonly source: 'derived' | 'unreleased'
  // Just the released section, for the GitHub release body.
  readonly section: string
}

/**
 * Promote the accrued `## [Unreleased]` block to `heading`, or fall back to the
 * commit-derived section when there is nothing accrued. The `[Unreleased]` block
 * is removed rather than left empty — the next hand-written note recreates it.
 */
export function promoteChangelog(
  config: PromoteChangelogConfig,
): PromotedChangelog {
  const cfg = { __proto__: null, ...config } as PromoteChangelogConfig
  const lines = cfg.changelog.split('\n')
  const range = unreleasedRange(lines)
  let remaining = lines
  let section = cfg.derivedSection
  let source: 'derived' | 'unreleased' = 'derived'
  if (range) {
    const body = lines
      .slice(range.start + 1, range.end)
      .join('\n')
      .trim()
    remaining = [...lines.slice(0, range.start), ...lines.slice(range.end)]
    if (sectionHasEntries(body)) {
      section = `${cfg.heading}\n\n${body}`
      source = 'unreleased'
    }
  }
  const insertAt = remaining.findIndex(line => line.startsWith('## '))
  const head = insertAt === -1 ? remaining : remaining.slice(0, insertAt)
  const tail = insertAt === -1 ? [] : remaining.slice(insertAt)
  const changelog = `${[...head, section, '', ...tail].join('\n').trimEnd()}\n`
  return { changelog, section, source }
}
