/**
 * @file Sort all-identifier boolean chains alphanumerically. Per CLAUDE.md
 *   "Sorting" rule, a chain like `agentshieldOk && zizmorOk && sfwOk` reads
 *   with the identifier names in alpha order: `agentshieldOk && sfwOk &&
 *   zizmorOk`. The runtime is short-circuit-insensitive to operand order
 *   *when every operand is a plain identifier* (no calls, no member access
 *   with getters) — so reordering doesn't change semantics. Sorting reduces
 *   diff churn when adding a new flag and makes "is everything ready?"
 *   checks visually consistent.
 *
 *   Detects: chains of `&&` or `||` whose operands are ALL bare Identifiers
 *   (length ≥ 2, no duplicates, uniform operator across the flattened chain).
 *
 *   Skipped (not reported, autofix-safe stays narrow):
 *
 *   - Any operand isn't a bare `Identifier` (Calls / member-access / literals
 *     / negations / nested non-uniform logical exprs short-circuit, and a
 *     `getter` on a member-access can have side effects — reordering would be
 *     observable).
 *   - Duplicate identifiers in the chain (rare, but rewriting through the
 *     duplicate would silently drop one).
 *   - Comments live between operands (autofix would relocate them).
 *   - Chain length < 2 (nothing to sort).
 *
 *   Why a separate rule from sort-equality-disjunctions: that rule sorts the
 *   right-hand string-literal of an equality chain (`x === 'a' || x === 'b'`);
 *   this rule sorts the bare-identifier operands of a pure-identifier chain.
 *   Structurally different ASTs, semantically different safety arguments.
 */

/**
 * @type {import('eslint').Rule.RuleModule}
 */

import type { AstNode, RuleContext, RuleFixer } from '../lib/rule-types.mts'

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Sort all-identifier boolean chains alphanumerically (`a && b && c`, `x || y || z`).',
      category: 'Stylistic Issues',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      unsorted:
        'Boolean chain identifiers are out of alphabetical order. Saw `{{actual}}`, expected `{{expected}}`.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

    /**
     * Flatten a left-associative LogicalExpression chain into leaf nodes.
     * `(a && b) && c` and `a && (b && c)` both flatten to [a, b, c]. Caller
     * checks operator uniformity.
     */
    function flatten(node: AstNode, op: string, out: AstNode[]): void {
      if (node.type === 'LogicalExpression' && node.operator === op) {
        flatten(node.left, op, out)
        flatten(node.right, op, out)
      } else {
        out.push(node)
      }
    }

    /**
     * Returns true if a comment lies anywhere between the first and last leaf
     * of the chain. Reordering through a comment would silently relocate
     * attribution.
     */
    function hasInteriorComment(leaves: AstNode[]): boolean {
      if (!sourceCode.getCommentsInside) {
        return false
      }
      const first = leaves[0]!
      const last = leaves[leaves.length - 1]!
      const all = sourceCode.getCommentsInside({
        range: [first.range[0], last.range[1]],
        loc: { start: first.loc.start, end: last.loc.end },
        type: 'Program',
      })
      return all.length > 0
    }

    function checkChain(rootNode: AstNode): void {
      // Top-level filter: only check the OUTERMOST `&&` or `||` of a chain.
      const parent = rootNode.parent
      if (
        parent &&
        parent.type === 'LogicalExpression' &&
        parent.operator === rootNode.operator
      ) {
        return
      }

      const op = rootNode.operator
      if (op !== '&&' && op !== '||') {
        return
      }

      const leaves: AstNode[] = []
      flatten(rootNode, op, leaves)
      if (leaves.length < 2) {
        return
      }

      // Every leaf must be a bare Identifier. Member-access (`a.b`) is
      // excluded because property getters can have side effects whose order
      // matters; calls are excluded because they're side-effecting; literals
      // and unary expressions don't fit the "list of flags" shape.
      const names: string[] = []
      for (const leaf of leaves) {
        if (leaf.type !== 'Identifier') {
          return
        }
        names.push(leaf.name)
      }

      // Skip duplicates — rewriting would lose information about which
      // position the duplicate lived at.
      if (new Set(names).size !== names.length) {
        return
      }

      const sortedNames = [...names].sort()
      const actualOrder = names.join(', ')
      const expectedOrder = sortedNames.join(', ')

      if (actualOrder === expectedOrder) {
        return
      }

      if (hasInteriorComment(leaves)) {
        context.report({
          node: rootNode,
          messageId: 'unsorted',
          data: { actual: actualOrder, expected: expectedOrder },
        })
        return
      }

      context.report({
        node: rootNode,
        messageId: 'unsorted',
        data: { actual: actualOrder, expected: expectedOrder },
        fix(fixer: RuleFixer) {
          // Replace each leaf's identifier text with the sorted-position
          // counterpart. The chain is homogeneous (same operator, all bare
          // identifiers, no duplicates), so the rewrite is purely a
          // reordering of operand names.
          const fixes: AstNode[] = []
          for (let i = 0; i < leaves.length; i++) {
            fixes.push(fixer.replaceText(leaves[i]!, sortedNames[i]!))
          }
          return fixes
        },
      })
    }

    return {
      LogicalExpression: checkChain,
    }
  },
}

export default rule
