/**
 * @file Flag empty Keep-a-Changelog section headings in CHANGELOG.md. A `###
 *   <SectionName>` heading whose next non-blank line is another `###` / `## [`
 *   heading or end-of-file has no bullets — and the canonical fleet rule
 *   (docs/agents.md/fleet/version-bumps.md §2) says "delete the heading when
 *   its body filters down to nothing." Empty headings make the reader
 *   disambiguate "section intentionally empty" from "section forgot its
 *   content." Pairs with the .claude/hooks/fleet/changelog-no-empty-guard/
 *   edit-time blocker. The hook catches the agent's Edit/Write; this rule
 *   catches any straggler that lands via direct editor save or via a different
 *   toolchain. Autofix: delete the empty heading line. Following blank lines
 *   are left alone (markdownlint's MD012 / MD022 handle multi- blank collapse
 *   and heading spacing). Scope: only matches files named CHANGELOG.md (any
 *   directory). Per-repo subdirs (e.g. packages/<pkg>/CHANGELOG.md) are linted
 *   on the same rule.
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import type { MarkdownlintRule } from './_shared/rule-types.mts'

const RULE_NAME = 'socket-no-empty-changelog-sections'

/**
 * Keep-a-Changelog headings the rule recognizes. Custom subsection names (`###
 * Internal`, `### Misc`, etc.) outside this set are left alone — the rule's job
 * is to keep the consumer-facing Keep-a-Changelog schema clean, not to police
 * every heading shape downstream chooses.
 */
const SECTION_NAMES = new Set([
  'Added',
  'Changed',
  'Deprecated',
  'Fixed',
  'Migration',
  'Performance',
  'Removed',
  'Renamed',
  'Security',
])

const rule: MarkdownlintRule = {
  description:
    'CHANGELOG.md Keep-a-Changelog section headings must have at least one bullet',
  function(params, onError) {
    const filePath = params.name ?? ''
    const baseName = normalizePath(filePath).split('/').pop() ?? ''
    if (baseName !== 'CHANGELOG.md') {
      return
    }
    const { lines } = params
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      if (!line || !line.startsWith('### ')) {
        continue
      }
      const name = line.slice(4).trim()
      if (!SECTION_NAMES.has(name)) {
        continue
      }
      // Scan forward for the next non-blank line.
      let nextNonBlank
      for (let j = i + 1; j < lines.length; j += 1) {
        const next = lines[j]
        if (next === undefined || next.trim() === '') {
          continue
        }
        nextNonBlank = next
        break
      }
      // Empty if next non-blank is a heading at the same/higher level
      // or end-of-file.
      const isEmpty =
        nextNonBlank === undefined ||
        nextNonBlank.startsWith('### ') ||
        nextNonBlank.startsWith('## ')
      if (!isEmpty) {
        continue
      }
      // Autofix: delete the heading line. Leave trailing blank lines
      // to markdownlint's standard rules (MD012, MD022) for cleanup —
      // collapsing them here could destroy intentional spacing around
      // adjacent real sections.
      onError({
        lineNumber: i + 1,
        detail: `Empty \`### ${name}\` section — delete the heading or add a bullet. Per docs/agents.md/fleet/version-bumps.md §2, public-facing-only filtering should drop the heading when it leaves no bullets.`,
        fixInfo: {
          lineNumber: i + 1,
          deleteCount: -1,
        },
      })
    }
  },
  names: [RULE_NAME, 'socket/no-empty-changelog-sections'],
  parser: 'none',
  tags: ['socket', 'fleet', 'changelog'],
}

// oxlint-disable-next-line socket/no-default-export -- markdownlint-cli2 loads custom rules via dynamic import and expects the default export to be the rule object.
export default rule
