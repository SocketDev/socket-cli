/**
 * @file Internal Markdown-rendering helpers for the release CHANGELOG —
 *   commit-type → section mapping, bullet escaping/formatting, and the
 *   `[Unreleased]` line-range scanner shared by section generation, merge, and
 *   promotion in `changelog.mts`. Nothing here is part of that file's public
 *   contract; `changelog.mts` imports these internally.
 */

import type { ConventionalCommit } from './changelog.mts'

// User-visible commit types → the Keep a Changelog section each lands under.
// A type absent from this map is internal churn and never reaches the CHANGELOG.
export const TYPE_TO_SECTION: Record<string, string> = {
  __proto__: null,
  feat: 'Added',
  fix: 'Fixed',
  perf: 'Changed',
  revert: 'Changed',
} as unknown as Record<string, string>

// Section display order in the generated entry.
export const SECTION_ORDER: readonly string[] = ['Added', 'Changed', 'Fixed']

/**
 * Render one bullet for a commit: a bold scope prefix when present, then the
 * description, emphasized when the commit is breaking.
 */
function escapeMarkdownText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

// A commit description is plain text, but it lands as free markdown prose in the
// generated bullet. A literal `*`, `_`, or backtick in it (glob patterns,
// identifiers, code refs like `_stream_*` or `*Options`) would otherwise render
// as a markdown emphasis/code span — and because CHANGELOG.md is lint-scoped,
// that trips markdownlint MD037/MD049/MD050 and blocks the release `fix` gate.
// Backslash-escape each so it renders verbatim. Single-pass (backslash first in
// the class) so an author-written backslash can't double-escape. Not applied to
// the scope: that is wrapped in a backtick code span where these chars are
// already literal, and adding backslashes there would show them.
function escapeMarkdownProse(value: string): string {
  return escapeMarkdownText(value).replace(/[\\`*_]/gu, '\\$&')
}

export function renderBullet(commit: ConventionalCommit): string {
  const scope = commit.scope
    ? `**\`${escapeMarkdownText(commit.scope)}\`** — `
    : ''
  const description = escapeMarkdownProse(commit.description)
  // A breaking change EMPHASIZES the change itself rather than carrying a
  // `**BREAKING:**` label. The label repeated a word the reader already has to
  // read past to reach what actually changed; emphasis puts the weight on the
  // change and keeps the bullet scannable.
  return `- ${scope}${commit.breaking ? `_${description}_` : description}`
}

/**
 * The `[start, end)` line range of the `## [Unreleased]` block within `lines`
 * (heading at `start`, `end` at the next `## ` heading or EOF), or undefined
 * when there is no `[Unreleased]` heading. One scanner, shared by
 * promote+merge.
 */
export function unreleasedRange(
  lines: readonly string[],
  unreleasedHeading: string,
): { end: number; start: number } | undefined {
  // Case-INSENSITIVE: `## [Unreleased]` is hand-authored as often as it is
  // generated, and `[unreleased]` / `[UNRELEASED]` mean the same section. An
  // exact match silently skipped those and promoted nothing, so the accrued
  // entries stayed behind while the release cut an empty section.
  const wanted = unreleasedHeading.trim().toLowerCase()
  const start = lines.findIndex(l => l.trim().toLowerCase() === wanted)
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

/**
 * Render a `{ section -> bullets }` map under `heading`, standard sections in
 * canonical order first, then any others. Empty sections are omitted.
 */
export function renderSectionMap(
  heading: string,
  bySection: Map<string, string[]>,
): string {
  const blocks: string[] = [heading]
  const emit = (section: string): void => {
    const bullets = bySection.get(section)
    if (bullets && bullets.length > 0) {
      blocks.push(`### ${section}\n\n${bullets.join('\n')}`)
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
