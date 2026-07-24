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
 * Render one bullet for a commit: a bold scope prefix when present, the
 * description, and a `**BREAKING:**` marker for breaking changes.
 */
function escapeMarkdownText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export function renderBullet(commit: ConventionalCommit): string {
  const breaking = commit.breaking ? '**BREAKING:** ' : ''
  const scope = commit.scope
    ? `**\`${escapeMarkdownText(commit.scope)}\`** — `
    : ''
  return `- ${breaking}${scope}${escapeMarkdownText(commit.description)}`
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
  const start = lines.findIndex(l => l.trim() === unreleasedHeading)
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
