/**
 * @file Per CLAUDE.md "Sorting" rule: sort the named-imports inside a single
 *   `import { ... }` statement alphanumerically (natural order:
 *   case-insensitive + numeric-aware). Default + namespace imports (`import
 *   foo, { ... } from`, `import * as ns from`) keep their leading binding; only
 *   the named-imports clause gets sorted. Detects `import { c, b, a } from
 *   'pkg'` (and aliased forms like `import { c as x, b, a } from 'pkg'`).
 *   Autofix: rewrites the brace contents in alphabetical order. Comments inside
 *   the brace are NOT moved — when there's a comment between specifiers, the
 *   rule skips the autofix and only reports, because reordering through a
 *   comment can break attribution. The rewrite preserves trailing-newline /
 *   multi-line layout: a single-line block stays single-line; a multi-line
 *   block stays multi-line with one specifier per line. Sort key: the
 *   _imported_ name (before any `as` alias), so `Z as a, A as z` sorts to `A as
 *   z, Z as a` (the import side is the stable identity, not the local).
 */

/**
 * @type {import('eslint').Rule.RuleModule}
 */

import { isAlreadySorted, stringComparator } from '../../lib/comparators.mts'
import { hasInteriorComments } from '../../lib/comment-checks.mts'

import type { AstNode, RuleContext, RuleFixer } from '../../lib/rule-types.mts'

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Sort named imports alphanumerically within an import statement.',
      category: 'Stylistic Issues',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      unsorted:
        'Named imports must be sorted alphabetically. Saw `{{actual}}`, expected `{{expected}}`.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

    function specSortKey(spec: AstNode): string {
      // ImportSpecifier — sort by `imported.name`.
      // Default / namespace specifiers don't appear in the named list.
      if (spec.imported && spec.imported.name) {
        return spec.imported.name
      }
      if (spec.imported && spec.imported.value) {
        return spec.imported.value
      }
      return spec.local && spec.local.name ? spec.local.name : ''
    }

    return {
      ImportDeclaration(node: AstNode) {
        // Pull only the named-imports (skip default + namespace).
        const named = node.specifiers.filter(
          (s: AstNode) => s.type === 'ImportSpecifier',
        )
        if (named.length < 2) {
          return
        }

        const keys = named.map(specSortKey)
        if (isAlreadySorted(keys)) {
          return
        }

        const sorted = [...named].toSorted((a, b) =>
          stringComparator(specSortKey(a), specSortKey(b)),
        )
        const sortedKeys = sorted.map(specSortKey)

        // If any comment lives between the first and last named
        // specifier, skip autofix — reordering through comments
        // breaks attribution.
        const first = named[0]
        const last = named[named.length - 1]

        if (hasInteriorComments(sourceCode, node, first, last)) {
          context.report({
            node,
            messageId: 'unsorted',
            data: {
              actual: keys.join(', '),
              expected: sortedKeys.join(', '),
            },
          })
          return
        }

        context.report({
          node,
          messageId: 'unsorted',
          data: {
            actual: keys.join(', '),
            expected: sortedKeys.join(', '),
          },
          fix(fixer: RuleFixer) {
            // Detect single-line vs multi-line by looking at the
            // first-token-after-`{` and last-token-before-`}`.
            // The slice between { and } — preserves `,` newline padding.
            const openBrace = sourceCode.getTokenBefore(first, {
              filter: (t: AstNode) => t.value === '{',
            })
            const closeBrace = sourceCode.getTokenAfter(last, {
              filter: (t: AstNode) => t.value === '}',
            })
            if (!openBrace || !closeBrace) {
              return undefined
            }
            const sliceStart = openBrace.range[1]
            const sliceEnd = closeBrace.range[0]
            const original = sourceCode.text.slice(sliceStart, sliceEnd)

            const isMultiline = /\n/.test(original)
            // Trim leading/trailing whitespace on the original to
            // detect indentation. Multi-line case preserves the
            // pre-spec indent.
            let indent = ''
            if (isMultiline) {
              const m = original.match(/\n([ \t]*)/)
              if (m) {
                indent = m[1]
              }
            }

            const specTexts = sorted.map(s => sourceCode.getText(s))
            let rebuilt
            if (isMultiline) {
              rebuilt = '\n' + specTexts.map(t => indent + t).join(',\n')
              // Detect trailing comma in the original.
              const trailingComma = /,\s*$/.test(original.replace(/\s+$/, ''))
                ? ','
                : ''
              // Trim trailing whitespace before the closing brace and
              // re-emit a newline + closing-brace indentation.
              const closeIndent = indent.replace(/^( {2}| {4}|\t)/, '')
              rebuilt += trailingComma + '\n' + closeIndent
            } else {
              rebuilt = ' ' + specTexts.join(', ') + ' '
            }

            return fixer.replaceTextRange([sliceStart, sliceEnd], rebuilt)
          },
        })
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
