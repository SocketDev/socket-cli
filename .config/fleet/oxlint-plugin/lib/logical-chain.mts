/**
 * @file Flatten a left-associative LogicalExpression chain of one operator into
 *   its leaf operands. `a && b && c` (a nested `((a && b) && c)`) → `[a, b,
 *   c]`. Extracted from sort-boolean-chains + sort-equality-disjunctions, which
 *   had byte-identical copies. Only descends through nodes whose operator
 *   matches `op`; any other node (including a `||` inside an `&&` chain) is a
 *   leaf.
 */

import type { AstNode } from './rule-types.mts'

export function flattenLogicalChain(
  node: AstNode,
  op: string,
  out: AstNode[],
): void {
  if (node.type === 'LogicalExpression' && node.operator === op) {
    flattenLogicalChain(node.left, op, out)
    flattenLogicalChain(node.right, op, out)
  } else {
    out.push(node)
  }
}
