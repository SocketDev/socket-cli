/**
 * @file Sort `new Set([...])` array elements alphanumerically. Per CLAUDE.md
 *   "Sorting" rule, Set/SafeSet constructor arguments are sorted (natural
 *   order: case-insensitive + numeric-aware). Order doesn't affect Set
 *   semantics but keeps diff churn low and reading easier. Autofix: rewrites
 *   the array literal in sorted order. Only fires when every element is a
 *   Literal (string or number) — mixed-type arrays or arrays containing
 *   identifiers/expressions get reported but not auto-fixed (sorting computed
 *   values would change behavior).
 */

import { stringComparator } from '../lib/comparators.mts'

import type { AstNode, RuleContext, RuleFixer } from '../lib/rule-types.mts'

const SET_NAMES = new Set(['SafeSet', 'Set'])

function isSortableElement(node: AstNode) {
  return (
    node !== null &&
    node.type === 'Literal' &&
    (typeof node.value === 'string' || typeof node.value === 'number')
  )
}

function compareSortable(a: AstNode, b: AstNode): number {
  return stringComparator(String(a.value), String(b.value))
}

/**
 * @type {import('eslint').Rule.RuleModule}
 */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Sort Set/SafeSet constructor array arguments alphanumerically (CLAUDE.md sorting rule).',
      category: 'Stylistic Issues',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      unsorted:
        '{{name}}([...]) elements should be sorted alphanumerically. Expected: [{{expected}}]',
      unsortedNoFix:
        '{{name}}([...]) elements should be sorted alphanumerically (mixed-type or non-literal elements; sort manually).',
    },
    schema: [],
  },

  create(context: RuleContext) {
    return {
      NewExpression(node: AstNode) {
        const callee = node.callee
        if (callee.type !== 'Identifier' || !SET_NAMES.has(callee.name)) {
          return
        }
        if (node.arguments.length !== 1) {
          return
        }
        const arg = node.arguments[0]
        if (arg.type !== 'ArrayExpression') {
          return
        }
        const els = arg.elements
        if (els.length < 2) {
          return
        }

        // Spread elements (`...X`) have no orderable token and a Set built
        // from spreads dedups regardless of order, so element order carries
        // no meaning — skip rather than nag for an impossible manual sort.
        if (
          els.some((e: AstNode) => e !== null && e.type === 'SpreadElement')
        ) {
          return
        }

        const allSortable = els.every(isSortableElement)
        if (!allSortable) {
          // Mixed-type or non-literal elements can't be compared reliably
          // (raw-text order != comparison order, e.g. '10' < '2' lexically
          // but 10 > 2 numerically), so no raw-text "already sorted"
          // shortcut: always flag for a manual sort.
          context.report({
            node: arg,
            messageId: 'unsortedNoFix',
            data: { name: callee.name },
          })
          return
        }

        const sorted = [...els].toSorted(compareSortable)
        const isSorted = sorted.every((s, i) => s === els[i])
        if (isSorted) {
          return
        }

        const sourceCode = context.getSourceCode
          ? context.getSourceCode()
          : context.sourceCode
        const expected = sorted.map(e => sourceCode.getText(e)).join(', ')

        context.report({
          node: arg,
          messageId: 'unsorted',
          data: { name: callee.name, expected },
          fix(fixer: RuleFixer) {
            const newText = `[${expected}]`
            return fixer.replaceText(arg, newText)
          },
        })
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
