/**
 * @fileoverview Sort `new Set([...])` array elements alphanumerically.
 * Per CLAUDE.md "Sorting" rule, Set/SafeSet constructor arguments are
 * sorted (literal byte order, ASCII before letters). Order doesn't
 * affect Set semantics but keeps diff churn low and reading easier.
 *
 * Autofix: rewrites the array literal in sorted order. Only fires
 * when every element is a Literal (string or number) — mixed-type
 * arrays or arrays containing identifiers/expressions get reported
 * but not auto-fixed (sorting computed values would change behavior).
 */

const SET_NAMES = new Set(['Set', 'SafeSet'])

function isSortableElement(node) {
  return (
    node !== null &&
    node.type === 'Literal' &&
    (typeof node.value === 'string' || typeof node.value === 'number')
  )
}

function compareSortable(a, b) {
  const aVal = String(a.value)
  const bVal = String(b.value)
  if (aVal < bVal) {
    return -1
  }
  if (aVal > bVal) {
    return 1
  }
  return 0
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'suggestion',
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

  create(context) {
    return {
      NewExpression(node) {
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

        const allSortable = els.every(isSortableElement)
        if (!allSortable) {
          // Check if it's already sorted by raw text — if so, no report.
          const raws = els.map(e => (e ? e.raw || '' : ''))
          const sortedRaws = [...raws].sort()
          if (raws.every((r, i) => r === sortedRaws[i])) {
            return
          }
          context.report({
            node: arg,
            messageId: 'unsortedNoFix',
            data: { name: callee.name },
          })
          return
        }

        const sorted = [...els].sort(compareSortable)
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
          fix(fixer) {
            const newText = `[${expected}]`
            return fixer.replaceText(arg, newText)
          },
        })
      },
    }
  },
}

export default rule
