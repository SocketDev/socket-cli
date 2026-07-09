/**
 * @file Per CLAUDE.md "npm-run-all-ordering" rule: flag a `run-s` or `run-p`
 *   string literal that uses a `:*` glob suffix (e.g. `"run-s gen:*"`). The
 *   npm-run-all2 task expander resolves globs via `Object.keys(scripts)`, which
 *   follows ECMA-262 OrdinaryOwnPropertyKeys §10.1.11 — package.json source
 *   order, not alphabetical. An order-dependent aggregator using a glob
 *   silently runs tasks in the order they were written, breaking on any reorder
 *   or insertion. Scope: string literals in `.ts`/`.mts` source files that
 *   construct or pass a `run-s`/`run-p` command containing a `:*` glob suffix.
 *   Does NOT parse `package.json` (oxlint operates on JS/TS AST); for
 *   `package.json`, the check script
 *   (`scripts/fleet/check/run-s-globs-are-explicit.mts`) and the edit guard
 *   (`no-glob-run-s-guard`) are the primary enforcers. Bypass (per-site, when
 *   the glob is provably order-independent): `oxlint-disable-next-line
 *   socket/no-glob-in-ordered-run-s -- order-independent`
 */

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

// Detects `run-s name:*` / `run-p name:*` patterns. The glob suffix `:*` is
// the npm-run-all2 wildcard form — `prefix:` before `*`, anchored at word
// boundary on the left. We require at least one colon before `*` to avoid
// matching a lone `*` passed to something else entirely. The glob may appear
// ANYWHERE in the argument list (`run-s build build-mcpb:*`), so scan to the
// end of the unquoted literal, not just the first argument.
const GLOB_RE = /\brun-[sp]\s[^'"`\n]*:\*/

/**
 * Returns the matched glob fragment for the diagnostic message, or undefined
 * when the literal doesn't contain the forbidden pattern.
 */
export function findGlob(value: string): string | undefined {
  const m = GLOB_RE.exec(value)
  if (!m) {
    return undefined
  }
  // Extract the `run-s|run-p <prefix>:*` fragment for the message.
  const fragment = m[0].trimEnd()
  return fragment
}

/**
 * @type {import('eslint').Rule.RuleModule}
 */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Avoid `:*` glob suffixes in `run-s`/`run-p` aggregators — npm-run-all2 expands them in package.json source order, not alphabetical. List tasks explicitly for order-dependent aggregators. CLAUDE.md "npm-run-all-ordering".',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      globInRunS:
        '`{{fragment}}` uses a `:*` glob suffix — npm-run-all2 resolves this in package.json source order (ECMA-262 §10.1.11), not alphabetical. List tasks explicitly for order-dependent aggregators, or add `oxlint-disable-next-line socket/no-glob-in-ordered-run-s -- order-independent` to assert the glob is safe.',
    },
    schema: [],
  },
  create(context: RuleContext) {
    function checkLiteral(node: AstNode, value: string): void {
      const fragment = findGlob(value)
      if (fragment === undefined) {
        return
      }
      context.report({
        node,
        messageId: 'globInRunS',
        data: { fragment },
      })
    }

    return {
      Literal(node: AstNode) {
        if (typeof node.value !== 'string') {
          return
        }
        checkLiteral(node, node.value)
      },
      TemplateLiteral(node: AstNode) {
        if (node.expressions.length !== 0) {
          for (const q of node.quasis) {
            const fragment = findGlob(q.value.cooked)
            if (fragment !== undefined) {
              context.report({
                node,
                messageId: 'globInRunS',
                data: { fragment },
              })
              return
            }
          }
          return
        }
        const cooked = node.quasis[0].value.cooked
        checkLiteral(node, cooked)
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
