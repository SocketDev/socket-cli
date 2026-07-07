/**
 * @file Forbid `structuredClone(x)` for the JSON-roundtrippable subset — fleet
 *   style. The common deep-clone use case (clone a `JSON.parse`d value to
 *   defend against caller mutation) is 3-5× faster as
 *   `JSON.parse(JSON.stringify(x))`. `structuredClone` runs the full HTML
 *   structured-clone algorithm — type tagging, transferable handling, prototype
 *   preservation, cycle detection — none of which apply to a value that just
 *   came out of `JSON.parse`. For caches, hot read-paths, and defensive-copy
 *   wrappers, the slower clone is real overhead at scale. When
 *   `structuredClone` IS the right tool (the value contains `Date`, `Map`,
 *   `Set`, `RegExp`, `ArrayBuffer`, typed arrays, `Error`, or
 *   non-JSON-roundtrippable shapes; or you genuinely need the prototype-
 *   preserving semantics), opt back in with a per-line disable and a
 *   one-sentence rationale:
 *
 *   ```ts
 *   // oxlint-disable-next-line socket/no-structured-clone-prefer-json -- value contains Date/Map; JSON round-trip would corrupt.
 *   const copy = structuredClone(value)
 *   ```
 *
 *   File-scope disables are banned per fleet convention — every callsite needs
 *   an independent rationale visible in `git blame`. No autofix — the rewrite
 *   (`JSON.parse(JSON.stringify(x))` or a primordial- safe equivalent like
 *   `JSONParse(JSONStringify(x))` from `@socketsecurity/lib/primordials/json`)
 *   is a judgment call about the value's shape that the linter can't make
 *   safely on its own. Reporting only.
 */

/**
 * @type {import('eslint').Rule.RuleModule}
 */

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid `structuredClone(...)` — for JSON-roundtrippable data, `JSON.parse(JSON.stringify(x))` is 3-5x faster. Disable per-line with a rationale when the value genuinely needs the spec-heavy clone (Date/Map/Set/etc).',
      category: 'Possible Errors',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      noStructuredClone:
        '`structuredClone(...)` runs the full HTML structured-clone algorithm — 3-5x slower than `JSON.parse(JSON.stringify(x))` for the JSON subset most callsites use. If the value came from `JSON.parse` (or is otherwise JSON-roundtrippable), use the JSON round-trip instead. When the value genuinely needs `Date` / `Map` / `Set` / `RegExp` / `ArrayBuffer` preservation, add `// oxlint-disable-next-line socket/no-structured-clone-prefer-json -- <reason>` with a one-sentence rationale.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    return {
      CallExpression(node: AstNode) {
        const callee = node.callee
        // Match the bare global identifier `structuredClone(...)`.
        // Don't flag `foo.structuredClone(...)` member calls — those are
        // user-defined methods unrelated to the global.
        if (callee.type !== 'Identifier') {
          return
        }
        if (callee.name !== 'structuredClone') {
          return
        }
        context.report({
          node: callee,
          messageId: 'noStructuredClone',
        })
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
