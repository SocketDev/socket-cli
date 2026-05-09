/**
 * @fileoverview Require every top-level `function` declaration to be
 * `export`ed. Per the fleet rule: "we should export all methods for
 * testing." Exposing internal helpers as named exports lets tests
 * import them directly, no `__test_only__` shim or per-test rebuild.
 *
 * Scope: top-level function declarations only (not class methods,
 * not arrow functions assigned to const, not local nested functions).
 * This is intentional — local helpers and arrow-as-const are visible
 * to their parent module's tests via the parent function; only the
 * top-level surface needs explicit export.
 *
 * Allowed exceptions (skipped):
 *   - The function is the `main()` entrypoint of a script (named `main`).
 *     Scripts run via `node scripts/foo.mts`; main() is the call target,
 *     not the test surface.
 *
 * No autofix: prepending `export` is mechanically safe but the
 * surrounding file may already export the function via a named
 * `export { ... }` statement, in which case the autofix would create a
 * duplicate. Reporting only — caller adds the keyword.
 */

const SCRIPT_ENTRY_NAMES = new Set(['main'])

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require top-level function declarations to be exported (testability).',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      missing:
        'Top-level function `{{name}}` should be `export function {{name}}`. Exporting internal helpers makes them directly testable.',
    },
    schema: [],
  },

  create(context) {
    return {
      'Program > FunctionDeclaration'(node) {
        if (!node.id || node.id.type !== 'Identifier') {
          return
        }
        const name = node.id.name
        if (SCRIPT_ENTRY_NAMES.has(name)) {
          return
        }
        context.report({
          node: node.id,
          messageId: 'missing',
          data: { name },
        })
      },
    }
  },
}

export default rule
