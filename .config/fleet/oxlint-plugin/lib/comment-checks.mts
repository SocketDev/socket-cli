/**
 * @file Shared comment-attribution guard for the `socket/sort-*` rules. A sort
 *   rule must NOT autofix when a comment sits between the first and last
 *   sibling it would reorder — moving the siblings would strand the comment on
 *   the wrong one. Each rule had its own copy of the `getCommentsInside` +
 *   range-filter check; this centralizes it.
 */

import type { AstNode } from './rule-types.mts'

/**
 * True when any comment lives strictly between `first` and `last` (inclusive of
 * their span) inside `container`. Callers pass the container node whose
 * children are being reordered plus the first and last child. Returns false
 * when the source-code object lacks `getCommentsInside` (older AST shapes) —
 * the rule then proceeds with the autofix, matching prior behavior.
 */
export function hasInteriorComments(
  sourceCode: {
    getCommentsInside?: ((node: AstNode) => AstNode[]) | undefined
  },
  container: AstNode,
  first: AstNode,
  last: AstNode,
): boolean {
  if (!sourceCode.getCommentsInside) {
    return false
  }
  return sourceCode
    .getCommentsInside(container)
    .some(
      (c: AstNode) =>
        c.range[0] >= first.range[0] && c.range[1] <= last.range[1],
    )
}
