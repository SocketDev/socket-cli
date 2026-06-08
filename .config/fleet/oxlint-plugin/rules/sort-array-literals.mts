/**
 * @file Sort an array literal's elements alphanumerically when it carries a
 *   leading `/* sort *​/` marker comment. Per CLAUDE.md "Sorting": config
 *   lists, allowlists, and set-like collections sort; position-bearing arrays
 *   (argv, priority lists, weight tables) keep their meaningful order. Plain
 *   arrays can't be sorted blindly — order often carries meaning — so this rule
 *   is OPT-IN: it fires only on an array whose declaration is preceded by a `/*
 *   sort *​/` block comment, where the author has declared the order
 *   irrelevant. Uses the fleet `stringComparator` (natural order:
 *   case-insensitive + numeric-aware), identical to the rest of the
 *   `socket/sort-*` family. Autofix rewrites the elements in order. Only fires
 *   when every element is a string/number Literal — a mixed-type or
 *   expression-bearing array is reported (so the marker isn't silently ignored)
 *   but not auto-fixed. Detection is range-based rather than
 *   AST-comment-attachment-based: oxlint attaches a leading comment to the
 *   `export`/declaration wrapper, not the ArrayExpression, so the rule pairs
 *   each `/* sort *​/` comment with the array whose `range[0]` follows it
 *   across only a declaration prefix (`export const NAME =`), nothing else.
 */

import { stringComparator } from '../lib/comparators.mts'

import type { AstNode, RuleContext, RuleFixer } from '../lib/rule-types.mts'

// The opt-in marker: a `/* sort */` block comment (any inner whitespace).
const SORT_MARKER_RE = /^\s*sort\s*$/

// Between the marker comment and the array's `[`, only a declaration prefix may
// appear: optional `export`, a `const`/`let`/`var`, an identifier, `=`, and
// whitespace. Anything else (other statements, a function call) means the
// marker doesn't belong to this array.
const DECL_PREFIX_RE = /^\s*(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*=\s*$/

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
        'Sort `/* sort */`-marked array literal elements alphanumerically (CLAUDE.md sorting rule).',
      category: 'Stylistic Issues',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      unsorted:
        '`/* sort */`-marked array elements should be sorted alphanumerically. Expected: [{{expected}}]',
      unsortedNoFix:
        '`/* sort */`-marked array has mixed-type or non-literal elements; sort manually or drop the marker.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

    // Range starts of every `/* sort */` marker comment's END offset, so an
    // array can ask "is a marker immediately before me?".
    const markerEnds: number[] = []
    const comments = sourceCode.getAllComments
      ? sourceCode.getAllComments()
      : []
    for (let i = 0, { length } = comments; i < length; i += 1) {
      const comment = comments[i]!
      if (comment.type === 'Block' && SORT_MARKER_RE.test(comment.value)) {
        markerEnds.push(comment.range[1])
      }
    }

    // True when a `/* sort */` marker ends just before `arrayStart`, separated
    // only by a declaration prefix.
    function markerPrecedes(arrayStart: number): boolean {
      for (let i = 0, { length } = markerEnds; i < length; i += 1) {
        const end = markerEnds[i]!
        if (end < arrayStart) {
          const between = sourceCode.text.slice(end, arrayStart)
          if (DECL_PREFIX_RE.test(between)) {
            return true
          }
        }
      }
      return false
    }

    return {
      ArrayExpression(node: AstNode) {
        if (markerEnds.length === 0 || !markerPrecedes(node.range[0])) {
          return
        }
        const els = node.elements
        if (els.length < 2) {
          return
        }
        if (
          els.some((e: AstNode) => e !== null && e.type === 'SpreadElement')
        ) {
          return
        }
        if (!els.every(isSortableElement)) {
          context.report({ node, messageId: 'unsortedNoFix' })
          return
        }
        const sorted = [...els].toSorted(compareSortable)
        if (sorted.every((s, i) => s === els[i])) {
          return
        }
        const expected = sorted.map(e => sourceCode.getText(e)).join(', ')
        context.report({
          node,
          messageId: 'unsorted',
          data: { expected },
          fix(fixer: RuleFixer) {
            return fixer.replaceText(node, `[${expected}]`)
          },
        })
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
