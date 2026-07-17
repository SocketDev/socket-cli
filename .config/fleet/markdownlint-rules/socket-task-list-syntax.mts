/*
 * @file Flag broken task-list syntax that GitHub does not render as a
 *   checkbox. The two broken patterns are:
 *
 *   1. "- []" — brackets with no space inside; GitHub treats it as a plain list
 *      item, not a task-list item.
 *   2. "- [ ]X" — a space inside the brackets but no space before the label text;
 *      GitHub renders the literal "[ ]X" as text. Valid checked items are "-
 *      [x]" and "- [X]" (both canonical GFM); they are NOT flagged. Autofix:
 *      insert the missing space where the fix is unambiguous (empty brackets →
 *      "- [ ]"; no-space-after → "- [ ] ").
 */

import type { MarkdownlintRule } from './_shared/rule-types.mts'

const RULE_NAME = 'socket-task-list-syntax'

// Matches "- []" — empty brackets with no space, optionally preceded by
// leading whitespace (for nested lists). The brackets may not contain a space
// (that is the other pattern) or x/X (valid checked item).
const EMPTY_BRACKETS_RE = /^(\s*-\s)\[\](\s|$)/

// Matches "- [ ]" or "- [x]"/"- [X]" followed immediately by a non-space
// character. We only flag the unchecked "[ ]" variant; "[x]"/"[X]" are valid.
const NO_SPACE_AFTER_RE = /^(\s*-\s\[ \])([^\s])/

const rule: MarkdownlintRule = {
  description:
    'Task-list items must use "- [ ]" (with a space between brackets and a space before the label) so GitHub renders a checkbox',
  function(params, onError) {
    const { lines } = params
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      if (!line) {
        continue
      }
      // Pattern 1: "- []" (no space inside brackets).
      const emptyMatch = EMPTY_BRACKETS_RE.exec(line)
      if (emptyMatch) {
        const prefix = emptyMatch[1]!
        // Replace "[]" with "[ ]": insert a space at the column after "[".
        const bracketOpenCol = prefix.length + 1
        onError({
          lineNumber: i + 1,
          detail:
            'Task-list brackets must contain a space: use "- [ ]" not "- []". GitHub does not render "- []" as a checkbox.',
          context: line.trim(),
          fixInfo: {
            lineNumber: i + 1,
            editColumn: bracketOpenCol + 1,
            deleteCount: 0,
            insertText: ' ',
          },
        })
        continue
      }
      // Pattern 2: "- [ ]text" (no space after the closing bracket).
      const noSpaceMatch = NO_SPACE_AFTER_RE.exec(line)
      if (noSpaceMatch) {
        const prefix = noSpaceMatch[1]!
        // Insert a space after "[ ]".
        const insertCol = prefix.length + 1
        onError({
          lineNumber: i + 1,
          detail:
            'Task-list item label must be separated from the brackets by a space: use "- [ ] text" not "- [ ]text". GitHub does not render "- [ ]text" as a checkbox.',
          context: line.trim(),
          fixInfo: {
            lineNumber: i + 1,
            editColumn: insertCol,
            deleteCount: 0,
            insertText: ' ',
          },
        })
      }
    }
  },
  names: [RULE_NAME, 'socket/task-list-syntax'],
  parser: 'none',
  tags: ['socket', 'fleet', 'gfm'],
}

// oxlint-disable-next-line socket/no-default-export -- markdownlint-cli2 loads custom rules via dynamic import and expects the default export to be the rule object.
export default rule
