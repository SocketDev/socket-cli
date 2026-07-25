/*
 * @file Sort all-identifier boolean chains alphanumerically. Per CLAUDE.md
 *   "Sorting" rule, a flag-list chain like `agentshieldOk && zizmorOk && sfwOk`
 *   reads with the identifier names in alpha order: `agentshieldOk && sfwOk &&
 *   zizmorOk`. The runtime is short-circuit-insensitive to operand order _when
 *   every operand is a plain identifier_ (no calls, no member access with
 *   getters) — so reordering doesn't change semantics. Sorting reduces diff
 *   churn when adding a new flag and makes "is everything ready?" checks
 *   visually consistent. Scope: lists of flags, not guard pairs. The rule ONLY
 *   fires on chains of length ≥ 3. Two-operand chains like `useHttp &&
 *   oauthEnabled` are guard patterns — the order carries narrative ("in HTTP
 *   mode, did OAuth get enabled?") that alpha-sort destroys. Three or more bare
 *   identifiers in a single chain is the structural signal that it's a flag
 *   list, not a guard. Detects: chains of `&&` or `||` whose operands are ALL
 *   bare Identifiers (length ≥ 3, no duplicates, uniform operator across the
 *   flattened chain). Skipped (not reported):
 *
 *   - Length 2 — guard patterns; narrative order is intentional.
 *   - Any operand isn't a bare `Identifier` (Calls / member-access / literals /
 *     negations / nested non-uniform logical exprs short-circuit, and a
 *     `getter` on a member-access can have side effects — reordering would be
 *     observable).
 *   - Duplicate identifiers in the chain (rare, but rewriting through the
 *     duplicate would silently drop one).
 *   - Comments live between operands (autofix would relocate them). Why a
 *     separate rule from sort-equality-disjunctions: that rule sorts the
 *     right-hand string-literal of an equality chain (`x === 'a' || x ===
 *     'b'`); this rule sorts the bare-identifier operands of a pure-identifier
 *     chain. Structurally different ASTs, semantically different safety
 *     arguments.
 */

/**
 * @type {import('eslint').Rule.RuleModule}
 */

import { flattenLogicalChain } from '../../lib/logical-chain.mts'

import type { AstNode, RuleContext, RuleFixer } from '../../lib/rule-types.mts'
import { isLockstepMirror } from '../../lib/lockstep-mirror.mts'

const rule = {
  meta: {
    type: 'problem',
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
    // Verbatim upstream mirrors keep upstream's shape; see lib/lockstep-mirror.mts.
    if (isLockstepMirror(context)) {
      return {}
    }
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

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

    // A `&&`/`||` chain is safe to reorder ONLY when its result is consumed as
    // a boolean test (truthiness only). In a VALUE position
    // (`const x = a && b`, `return a && b`, a call arg) `&&`/`||` yields a
    // SPECIFIC operand, so reordering changes the value: `(c && a && b)` is `0`
    // but `(a && b && c)` is `null`. Walk out through same-operator parents and
    // `!`, then require a boolean-test consumer.
    function isInBooleanContext(node: AstNode): boolean {
      let cur = node
      let parent = cur.parent
      while (parent) {
        // `!chain` coerces to boolean regardless of what consumes the result,
        // so the operand order only affects truthiness — safe to reorder.
        if (parent.type === 'UnaryExpression' && parent.operator === '!') {
          return true
        }
        // Enclosing `&&`/`||` — the chain's value flows up; keep walking so the
        // OUTER consumer decides (e.g. `if (x && (a && b))`).
        if (parent.type === 'LogicalExpression') {
          cur = parent
          parent = cur.parent
          continue
        }
        if (
          (parent.type === 'ConditionalExpression' ||
            parent.type === 'DoWhileStatement' ||
            parent.type === 'IfStatement' ||
            parent.type === 'WhileStatement') &&
          parent.test === cur
        ) {
          return true
        }
        if (parent.type === 'ForStatement' && parent.test === cur) {
          return true
        }
        return false
      }
      return false
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
      // Only reorder when the chain is a boolean test, never a value.
      if (!isInBooleanContext(rootNode)) {
        return
      }

      const op = rootNode.operator
      if (op !== '&&' && op !== '||') {
        return
      }

      const leaves: AstNode[] = []
      flattenLogicalChain(rootNode, op, leaves)
      // Length 2 chains are guard patterns (`useHttp && oauthEnabled`)
      // where order carries narrative; only length 3+ chains are flag
      // lists where alpha-sort is unambiguously a readability win.
      if (leaves.length < 3) {
        return
      }

      // Every leaf must be a bare Identifier. Member-access (`a.b`) is
      // excluded because property getters can have side effects whose order
      // matters; calls are excluded because they're side-effecting; literals
      // and unary expressions don't fit the "list of flags" shape.
      const names: string[] = []
      for (let i = 0, { length } = leaves; i < length; i += 1) {
        const leaf = leaves[i]!
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

      const sortedNames = [...names].toSorted()
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

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
