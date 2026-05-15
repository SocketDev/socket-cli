/**
 * @fileoverview Sort string-equality disjunctions alphanumerically.
 *
 * Per CLAUDE.md "Sorting" rule, `x === 'a' || x === 'b' || x === 'c'`
 * is sorted by the comparand string (literal byte order, ASCII before
 * letters). Order doesn't affect runtime semantics — JS's `||`
 * short-circuits regardless of operand order — but keeps the diff
 * churn low when adding a new comparand and makes "is X in this set?"
 * checks visually consistent across the fleet.
 *
 * Detects:
 *   - `(x === 'a' || x === 'b')`
 *   - `(x !== 'a' && x !== 'b')` — De Morgan dual; ordering rule applies
 *   - Chains of any length (≥2 operands).
 *
 * Each disjunction must:
 *   - Use the SAME left operand (`x` in the example) for every clause.
 *   - Use the SAME comparison operator (`===` for `||` chains, `!==`
 *     for `&&` chains).
 *   - Use string-literal right operands (number / boolean / template
 *     literals are skipped — those rarely benefit from alpha order
 *     and confuse the autofix).
 *
 * Autofix: rewrites the right-hand string literals in sorted order.
 * Skipped (reports without fix) when:
 *   - Any clause's left operand differs (mixed identifier).
 *   - Any clause's right operand isn't a plain string literal.
 *   - Any clause uses a different operator from the first.
 *   - Comments live between clauses (reordering through a comment
 *     would break attribution).
 *
 * Why a separate rule from sort-named-imports / sort-set-args:
 *   - The shape is structurally different (BinaryExpression chain
 *     under LogicalExpression, not an ArrayExpression / ImportSpecifier).
 *   - Catches the most common "is this one of these constants?"
 *     pattern in dispatch code (e.g. switch-prelude guards,
 *     fix-action category checks). A single rule keeps this normalized.
 */

/** @type {import('eslint').Rule.RuleModule} */

import type { AstNode, RuleContext, RuleFixer } from '../lib/rule-types.mts'

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Sort string-equality disjunctions alphanumerically (`x === "a" || x === "b"`).',
      category: 'Stylistic Issues',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      unsorted:
        'String-equality disjunction operands are out of alphabetical order. Saw `{{actual}}`, expected `{{expected}}`.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

    /**
     * Flatten a left-associative LogicalExpression chain into a list
     * of leaf nodes. `(a || b) || c` and `a || (b || c)` both flatten
     * to [a, b, c]. We require the chain operator to be uniform
     * (caller checks).
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
     * For a binary-equality leaf, return `{ left, right, operator }`
     * if it's the shape we sort. Returns undefined otherwise.
     */
    function asEqualityClause(node: AstNode) {
      if (node.type !== 'BinaryExpression') {
        return undefined
      }
      if (node.operator !== '===' && node.operator !== '!==') {
        return undefined
      }
      // Right side must be a plain string-literal Identifier-comparand pattern.
      if (
        node.right.type !== 'Literal' ||
        typeof node.right.value !== 'string'
      ) {
        return undefined
      }
      // Left side: prefer Identifier, but accept MemberExpression so
      // `cat.x === 'a' || cat.x === 'b'` works too.
      if (
        node.left.type !== 'Identifier' &&
        node.left.type !== 'MemberExpression'
      ) {
        return undefined
      }
      return {
        leftText: sourceCode.getText(node.left),
        operator: node.operator,
        right: node.right,
        rightValue: node.right.value,
      }
    }

    /**
     * Returns true if a comment lies anywhere between the first and
     * last leaf of the chain. Comment-aware skipping prevents the
     * autofix from silently relocating attribution.
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
      // Top-level filter: only check the OUTERMOST `||` or `&&` of a
      // chain, not its sub-expressions. We detect "outermost" by the
      // parent being either non-LogicalExpression or a different
      // operator.
      const parent = rootNode.parent
      if (
        parent &&
        parent.type === 'LogicalExpression' &&
        parent.operator === rootNode.operator
      ) {
        return
      }

      const op = rootNode.operator
      // We only process || and && chains.
      if (op !== '||' && op !== '&&') {
        return
      }

      const leaves: AstNode[] = []
      flatten(rootNode, op, leaves)
      if (leaves.length < 2) {
        return
      }

      type Clause = {
        leftText: string
        operator: string
        right: AstNode
        rightValue: string
      }
      const clauses: Clause[] = []
      for (const leaf of leaves) {
        const c = asEqualityClause(leaf)
        if (!c) {
          // Mixed shape — skip the whole chain. The rule only
          // applies to homogeneous equality chains.
          return
        }
        clauses.push(c)
      }

      // Operator/leftText must be uniform within the chain. For `||`
      // chains the natural shape is `===`; for `&&` chains it's `!==`
      // (De Morgan). Mixed → skip (rare and the rewrite would change
      // semantics).
      const firstLeft = clauses[0]!.leftText
      const firstOp = clauses[0]!.operator
      for (let i = 1; i < clauses.length; i++) {
        if (
          clauses[i]!.leftText !== firstLeft ||
          clauses[i]!.operator !== firstOp
        ) {
          return
        }
      }

      // For `||` chains, expect `===`. For `&&` chains, expect `!==`.
      // Other combinations are valid logic but not the shape this rule
      // sorts (they'd be tautologies or contradictions).
      if (op === '||' && firstOp !== '===') {
        return
      }
      if (op === '&&' && firstOp !== '!==') {
        return
      }

      // Compute the sorted order.
      const sortedClauses = [...clauses].sort((a, b) => {
        if (a.rightValue < b.rightValue) {
          return -1
        }
        if (a.rightValue > b.rightValue) {
          return 1
        }
        return 0
      })

      const actualOrder = clauses.map(c => c.rightValue).join(', ')
      const expectedOrder = sortedClauses.map(c => c.rightValue).join(', ')

      if (actualOrder === expectedOrder) {
        return
      }

      // Check for interior comments — skip autofix if any.
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
          // Replace each leaf's right-string-literal with the
          // sorted-position counterpart. Because the chain is
          // homogeneous (same left, same op), the rewrite is safe
          // semantically — only the comparand strings reorder.
          const fixes: AstNode[] = []
          for (let i = 0; i < leaves.length; i++) {
            const leaf = leaves[i]!
            const targetRight = sortedClauses[i]!.right
            // The leaf's right node is what we rewrite.
            // BinaryExpression.right's range covers just the literal.
            const rawTarget = sourceCode.getText(targetRight)
            fixes.push(
              fixer.replaceText(asEqualityClause(leaf)!.right, rawTarget),
            )
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
