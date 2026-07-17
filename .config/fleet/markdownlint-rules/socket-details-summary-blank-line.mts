/**
 * @file Flag a "</summary>" closing tag whose next non-empty line is markdown
 *   content without a blank line separating them. GitHub's Markdown renderer
 *   requires a blank line after </summary> for the body to be parsed as
 *   Markdown; without it the body renders as literal text inside the <details>
 *   block. Autofix: insert the required blank line after </summary>. A
 *   </summary> already followed by a blank line, or immediately by </details>,
 *   passes without error.
 */

import type { MarkdownlintRule } from './_shared/rule-types.mts'

const RULE_NAME = 'socket-details-summary-blank-line'

// Matches any line whose last non-whitespace content is </summary>.
// This covers both:
//   <summary>Title</summary>   (open and close on one line)
//   </summary>                 (close tag on its own line)
const SUMMARY_CLOSE_RE = /^.*<\/summary>\s*$/i

const rule: MarkdownlintRule = {
  description:
    'A </summary> tag must be followed by a blank line so GitHub renders the <details> body as Markdown',
  function(params, onError) {
    const { lines } = params
    // Fence state: a </summary> INSIDE a fenced code block is example text
    // (e.g. a doc demonstrating the <details> pattern in a ```markdown
    // fence), not real markup — skip it. Both ``` and ~~~ fences count.
    let inFence = false
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      if (line !== undefined && /^\s*(?:```|~~~)/.test(line)) {
        inFence = !inFence
        continue
      }
      if (inFence || !line || !SUMMARY_CLOSE_RE.test(line)) {
        continue
      }
      // Find the next non-empty line after </summary>.
      let nextNonEmptyIndex = -1
      let nextNonEmptyLine = ''
      for (let j = i + 1; j < lines.length; j += 1) {
        const candidate = lines[j]
        if (candidate !== undefined && candidate.trim() !== '') {
          nextNonEmptyIndex = j
          nextNonEmptyLine = candidate
          break
        }
      }
      // If end-of-file or the next non-empty line is </details>, nothing to fix.
      if (
        nextNonEmptyIndex === -1 ||
        /^\s*<\/details>/i.test(nextNonEmptyLine)
      ) {
        continue
      }
      // A blank line between </summary> and the next non-empty line means
      // nextNonEmptyIndex > i + 1 — at least one empty line sits in between.
      if (nextNonEmptyIndex > i + 1) {
        continue
      }
      // No blank line: the line immediately after </summary> is content.
      onError({
        lineNumber: i + 1,
        detail:
          'Missing blank line after </summary>. GitHub requires a blank line between </summary> and the <details> body for Markdown rendering; without it the body appears as literal text.',
        context: line.trim(),
        fixInfo: {
          // Append a newline at the end of the </summary> line, producing
          // the blank line GitHub needs between the summary and body.
          lineNumber: i + 1,
          editColumn: line.length + 1,
          deleteCount: 0,
          insertText: '\n',
        },
      })
    }
  },
  names: [RULE_NAME, 'socket/details-summary-blank-line'],
  parser: 'none',
  tags: ['socket', 'fleet', 'gfm'],
}

// oxlint-disable-next-line socket/no-default-export -- markdownlint-cli2 loads custom rules via dynamic import and expects the default export to be the rule object.
export default rule
