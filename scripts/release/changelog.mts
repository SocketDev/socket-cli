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

import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'

import type { ConventionalCommit } from './version.mts'
import type { Nodes, Root } from 'mdast'

export const UNRELEASED_HEADING = '## [Unreleased]'

/**
 * Parse markdown the way GitHub renders it (GFM) into a position-tracked
 * mdast tree. Structure questions — where a heading is, whether a block has
 * bullets — are answered from this tree, never by scanning raw lines: a `## `
 * or `- ` inside a fenced code block is content, not structure.
 */
function parseMarkdown(source: string): Root {
  return fromMarkdown(source, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  })
}

/**
 * 0-based line indexes of the document's headings at `depth`, from
 * parser-reported positions.
 */
function headingLineIndexes(source: string, depth: number): number[] {
  const indexes: number[] = []
  for (const node of parseMarkdown(source).children) {
    if (
      node.type === 'heading' &&
      node.depth === depth &&
      node.position?.start.line !== undefined
    ) {
      indexes.push(node.position.start.line - 1)
    }
  }
  return indexes
}

function h2LineIndexes(source: string): number[] {
  return headingLineIndexes(source, 2)
}

/** `'### Changed'` → `'Changed'`. */
function headingText(line: string): string {
  return line.trim().replace(/^#+\s*/, '')
}

/** Drop leading and trailing blank lines, in place. */
function trimBlankEdges(lines: string[]): void {
  while (lines.length && !lines[0]!.trim()) {
    lines.shift()
  }
  while (lines.length && !lines[lines.length - 1]!.trim()) {
    lines.pop()
  }
}

function hasListItem(node: Nodes): boolean {
  if (node.type === 'listItem') {
    return true
  }
  if ('children' in node) {
    return node.children.some(hasListItem)
  }
  return false
}

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
 * True when a rendered section carries at least one real list item, as
 * opposed to a bare heading with nothing under it. Parsed, not pattern
 * matched: a `- ` line inside a fenced code block is not an entry.
 */
export function sectionHasEntries(section: string): boolean {
  return parseMarkdown(section).children.some(hasListItem)
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
  const headings = h2LineIndexes(lines.join('\n'))
  const at = headings.findIndex(
    index => lines[index]!.trim().toLowerCase() === wanted,
  )
  if (at === -1) {
    return undefined
  }
  const start = headings[at]!
  const end = at + 1 < headings.length ? headings[at + 1]! : lines.length
  return { end, start }
}

/**
 * Line index of the `## [Unreleased]` heading, tolerating a decorated variant
 * such as `## [Unreleased] - 2026-08-27`, or undefined when there is none.
 *
 * `unreleasedRange` matches the heading for equality, so a decorated one is
 * invisible to the release: the block is never promoted and its notes strand
 * under a heading no release will ever pick up — this is how v1.1.161 shipped
 * with commit-derived notes. The writer finds the decorated heading so it can
 * repair it, rather than adding a second block the release also cannot see.
 */
function unreleasedHeadingIndex(lines: readonly string[]): number | undefined {
  return h2LineIndexes(lines.join('\n')).find(index =>
    /^\[unreleased\]/i.test(headingText(lines[index]!)),
  )
}

/**
 * Rank of `section` in `SECTION_ORDER`, with anything unrecognized sorting last
 * so a bespoke section keeps its place at the end of the block.
 */
function sectionRank(section: string): number {
  const at = SECTION_ORDER.findIndex(
    known => known.toLowerCase() === section.toLowerCase(),
  )
  return at === -1 ? SECTION_ORDER.length : at
}

/**
 * Write `bullet` into `body`'s `### <section>` block, creating that section in
 * `SECTION_ORDER` position when it is missing. When `replace` matches the text
 * of a bullet already in the section, that bullet is rewritten in place rather
 * than a second one appended.
 */
function writeSectionEntry(
  body: readonly string[],
  section: string,
  bullet: string,
  replace: RegExp | undefined,
): string[] {
  const lines = [...body]
  const h3s = headingLineIndexes(lines.join('\n'), 3)
  const at = h3s.find(
    index => headingText(lines[index]!).toLowerCase() === section.toLowerCase(),
  )
  if (at === undefined) {
    const before = h3s.find(
      index => sectionRank(headingText(lines[index]!)) > sectionRank(section),
    )
    if (before === undefined) {
      let end = lines.length
      while (end > 0 && !lines[end - 1]!.trim()) {
        end -= 1
      }
      lines.splice(end, 0, ...(end ? [''] : []), `### ${section}`, bullet)
    } else {
      lines.splice(before, 0, `### ${section}`, bullet, '')
    }
    return lines
  }
  const next = h3s.find(index => index > at) ?? lines.length
  if (replace) {
    // A global or sticky regex carries lastIndex between calls, so a caller's
    // /g would make every other test fail. Match with a stateless copy.
    const matcher =
      replace.global || replace.sticky
        ? new RegExp(replace.source, replace.flags.replace(/[gy]/gu, ''))
        : replace
    for (let i = at + 1; i < next; i += 1) {
      const line = lines[i]!
      const text = /^\s*-\s+/.exec(line)
        ? line.replace(/^\s*-\s+/, '')
        : undefined
      if (text !== undefined && matcher.test(text)) {
        lines[i] = bullet
        return lines
      }
    }
  }
  let insertAt = next
  while (insertAt > at + 1 && !lines[insertAt - 1]!.trim()) {
    insertAt -= 1
  }
  lines.splice(insertAt, 0, bullet)
  return lines
}

export interface AddUnreleasedEntryConfig {
  readonly changelog: string
  // The bullet's text, without the leading `- `.
  readonly entry: string
  // Tested against the TEXT of each bullet already in the section (the `- ` is
  // stripped first). The first match is rewritten instead of a second bullet
  // being appended, so a repeated bump updates its own line.
  readonly replace?: RegExp | undefined
  // Keep a Changelog section the entry belongs under. Defaults to `Changed`.
  readonly section?: string | undefined
}

/**
 * Add `entry` to the changelog's `## [Unreleased]` block and return the whole
 * file. The counterpart to `promoteChangelog`: this is how a note accrues, that
 * is how a release consumes it.
 *
 * NOTHING ELSE MOVES. The release owns `package.json`'s version and every
 * `## [X.Y.Z]` heading — it derives the version from the tags and promotes this
 * block under a heading it writes itself. A caller that writes either invents a
 * version that may never ship and consumes the block the release meant to
 * promote, which has already cost a release its notes. So an accruing note goes
 * here and only here, whether a human, the `/bump-coana` skill, or another
 * repo's automation is writing it.
 *
 * The block is created when the previous release consumed it, and a decorated
 * heading is repaired, so there is always somewhere for the entry to go that
 * the release can actually see.
 */
export function addUnreleasedEntry(config: AddUnreleasedEntryConfig): string {
  const cfg = { __proto__: null, ...config } as AddUnreleasedEntryConfig
  const lines = cfg.changelog.split('\n')

  const heading = unreleasedHeadingIndex(lines)
  if (heading === undefined) {
    lines.splice(
      h2LineIndexes(lines.join('\n'))[0] ?? lines.length,
      0,
      UNRELEASED_HEADING,
      '',
    )
  } else {
    lines[heading] = UNRELEASED_HEADING
  }
  // Present by construction: the heading was either found or just inserted.
  const range = unreleasedRange(lines)!

  const body = writeSectionEntry(
    lines.slice(range.start + 1, range.end),
    cfg.section ?? 'Changed',
    `- ${cfg.entry}`,
    cfg.replace,
  )
  const head = lines.slice(0, range.start)
  const tail = lines.slice(range.end)
  trimBlankEdges(head)
  trimBlankEdges(body)
  return [
    ...(head.length ? [...head, ''] : []),
    UNRELEASED_HEADING,
    '',
    ...body,
    '',
    ...tail,
  ].join('\n')
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
  const insertAt = h2LineIndexes(remaining.join('\n'))[0] ?? -1
  const head = insertAt === -1 ? remaining : remaining.slice(0, insertAt)
  const tail = insertAt === -1 ? [] : remaining.slice(insertAt)
  const changelog = `${[...head, section, '', ...tail].join('\n').trimEnd()}\n`
  return { changelog, section, source }
}
