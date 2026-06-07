/**
 * @file Shared "is there a bypass marker adjacent to this node?" scanner used
 *   by the rules that support an inline opt-out comment
 *   (`no-which-for-local-bin` → `socket-lint: allow which-lookup`,
 *   `prefer-ellipsis-char` → `socket-lint: allow literal-ellipsis`,
 *   `use-fleet-canonical-api-token-getter` → `socket-api-token-getter: allow
 *   direct-env`). Why a source-text line scan instead of the AST comment APIs:
 *   at the catalog-pinned oxlint version the plugin engine's
 *   `getCommentsBefore` / `getCommentsAfter` return nothing for the nodes these
 *   rules report on, so a comment-attachment approach silently fails to
 *   suppress. Scanning the raw source by line is engine-version-independent.
 *   `makeBypassChecker(context, bypassRe)` reads the source once per
 *   `create(context)` call and returns `hasBypassComment(node)`. A node is
 *   bypassed when the marker appears on the node's own line (trailing comment)
 *   or in the contiguous block of comment lines directly above it — the walk
 *   stops at the first non-comment, non-blank line so the marker must be
 *   genuinely adjacent, not somewhere arbitrary earlier in the file.
 */

import type { AstNode, RuleContext } from './rule-types.mts'

// How far up a leading-comment block to look for the marker. A leading marker
// comment may wrap onto a couple of continuation lines, so allow a few.
const MAX_LEADING_COMMENT_LINES = 3

// A line that is entirely a comment (`//`, `/*`, or a `*` block continuation).
// Used to keep walking upward through a contiguous comment block.
const COMMENT_LINE_RE = /^\s*(?:\*|\/\*|\/\/)/

/**
 * The raw source text for the file being linted, across the context shapes the
 * oxlint plugin engine exposes (`getSourceCode().getText()` vs a `sourceCode`
 * with `getText()` or a `.text` field).
 */
function sourceTextOf(context: RuleContext): string {
  const sourceCode = context.getSourceCode
    ? context.getSourceCode()
    : context.sourceCode
  if (typeof sourceCode?.getText === 'function') {
    return sourceCode.getText()
  }
  return (sourceCode as { text?: string | undefined })?.text ?? ''
}

/**
 * 1-based start line of a node, derived from `loc` when present, else by
 * counting newlines up to the node's start offset in `sourceText`. Returns -1
 * when neither is available.
 */
function nodeStartLine(node: AstNode, sourceText: string): number {
  const locLine = (
    node as {
      loc?: { start?: { line?: number | undefined } | undefined } | undefined
    }
  )?.loc?.start?.line
  if (typeof locLine === 'number') {
    return locLine
  }
  const start = (node as { range?: [number, number] | undefined }).range?.[0]
  if (typeof start !== 'number') {
    return -1
  }
  let line = 1
  for (let i = 0; i < start && i < sourceText.length; i += 1) {
    if (sourceText[i] === '\n') {
      line += 1
    }
  }
  return line
}

/**
 * Build a `hasBypassComment(node)` predicate for `bypassRe`, reading the source
 * once. True when the marker is on the node's own line or in the contiguous
 * comment block immediately above it.
 */
export function makeBypassChecker(
  context: RuleContext,
  bypassRe: RegExp,
): (node: AstNode) => boolean {
  const sourceText = sourceTextOf(context)
  const sourceLines = sourceText.split('\n')

  return function hasBypassComment(node: AstNode): boolean {
    const line = nodeStartLine(node, sourceText)
    if (line < 1) {
      return false
    }
    // sourceLines is 0-indexed; node line is 1-based, so the node's own line
    // is sourceLines[line - 1]. Check that (trailing-comment case) first.
    const ownIdx = line - 1
    if (
      ownIdx >= 0 &&
      ownIdx < sourceLines.length &&
      bypassRe.test(sourceLines[ownIdx]!)
    ) {
      return true
    }
    // Then walk up through a contiguous leading-comment block.
    for (
      let idx = ownIdx - 1;
      idx >= 0 && idx >= ownIdx - MAX_LEADING_COMMENT_LINES;
      idx -= 1
    ) {
      const text = sourceLines[idx]!
      if (bypassRe.test(text)) {
        return true
      }
      // Stop once we pass a non-comment, non-blank line: the marker must be in
      // the comment block adjacent to the read, not arbitrarily earlier.
      if (text.trim() !== '' && !COMMENT_LINE_RE.test(text)) {
        break
      }
    }
    return false
  }
}
