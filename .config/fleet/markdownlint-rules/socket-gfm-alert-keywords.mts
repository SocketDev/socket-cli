/**
 * @file Flag non-canonical GFM alert keywords inside blockquotes. GitHub only
 *   renders the five canonical alert markers as styled callout boxes:
 *   NOTE, TIP, IMPORTANT, WARNING, CAUTION (uppercase, singular, no typos).
 *   Any other spelling — plurals like NOTES/TIPS/WARNINGS/CAUTIONS/IMPORTANTS,
 *   lowercase or mixed-case variants, or unknown keywords — silently renders as
 *   plain blockquote text with no callout styling. Autofix: map common
 *   plurals and lowercase forms to their canonical uppercase singular form.
 */

import type { MarkdownlintRule } from './_shared/rule-types.mts'

const RULE_NAME = 'socket-gfm-alert-keywords'

/**
 * The five canonical alert keywords GitHub recognizes for styled callout
 * rendering. Only these exact uppercase spellings produce the callout UI.
 */
const CANONICAL_KEYWORDS = new Set([
  'CAUTION',
  'IMPORTANT',
  'NOTE',
  'TIP',
  'WARNING',
])

/**
 * Map from non-canonical keyword (lowercase normalised) to its canonical form.
 * Covers plurals and case variants the rule's fixInfo can correct
 * automatically.
 */
const CANONICAL_MAP = new Map<string, string>([
  ['caution', 'CAUTION'],
  ['cautions', 'CAUTION'],
  ['important', 'IMPORTANT'],
  ['importants', 'IMPORTANT'],
  ['note', 'NOTE'],
  ['notes', 'NOTE'],
  ['tip', 'TIP'],
  ['tips', 'TIP'],
  ['warning', 'WARNING'],
  ['warnings', 'WARNING'],
])

// Matches "> [!KEYWORD]" where KEYWORD is one or more word characters.
// The leading whitespace is optional; > may be indented up to 3 spaces.
const ALERT_LINE_RE = /^(\s{0,3}>\s*\[!)([A-Za-z]+)(\])/

const rule: MarkdownlintRule = {
  description:
    'GFM alert markers must use one of the five canonical keywords (NOTE/TIP/IMPORTANT/WARNING/CAUTION)',
  function(params, onError) {
    const { lines } = params
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      if (!line) {
        continue
      }
      const match = ALERT_LINE_RE.exec(line)
      if (!match) {
        continue
      }
      const keyword = match[2]
      if (!keyword || CANONICAL_KEYWORDS.has(keyword)) {
        continue
      }
      const canonical = CANONICAL_MAP.get(keyword.toLowerCase())
      // The prefix is "> [!" and the suffix is "]"; editColumn is 1-based.
      // The keyword starts after the prefix captured in match[1].
      const prefixLen = match[1]!.length
      const editColumn = prefixLen + 1
      onError({
        lineNumber: i + 1,
        detail: `Non-canonical GFM alert keyword \`[!${keyword}]\`. GitHub only renders NOTE, TIP, IMPORTANT, WARNING, and CAUTION as styled callouts; any other spelling silently falls back to plain blockquote text.`,
        context: line.trim(),
        fixInfo: canonical
          ? {
              lineNumber: i + 1,
              editColumn,
              deleteCount: keyword.length,
              insertText: canonical,
            }
          : undefined,
      })
    }
  },
  names: [RULE_NAME, 'socket/gfm-alert-keywords'],
  parser: 'none',
  tags: ['socket', 'fleet', 'gfm'],
}

// oxlint-disable-next-line socket/no-default-export -- markdownlint-cli2 loads custom rules via dynamic import and expects the default export to be the rule object.
export default rule
