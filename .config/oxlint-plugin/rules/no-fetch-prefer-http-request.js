/**
 * @fileoverview Per CLAUDE.md "HTTP — never `fetch()`. Use httpJson /
 * httpText / httpRequest from @socketsecurity/lib/http-request."
 *
 * Reports any `fetch(...)` call (global fetch). Does NOT auto-fix
 * because the right replacement (`httpJson` vs `httpText` vs
 * `httpRequest`) depends on what the caller does with the response —
 * a wrong autofix would silently change behavior. Reporting only.
 *
 * Allowed exceptions (skipped):
 *   - `globalThis.fetch` — explicit reference (often for monkey-patching
 *     in tests).
 *   - Method calls (`obj.fetch(...)`) — those aren't the global.
 */

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Use httpJson / httpText / httpRequest from @socketsecurity/lib/http-request instead of global fetch().',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      banned:
        'global fetch() — use httpJson / httpText / httpRequest from @socketsecurity/lib/http-request. The right replacement depends on what you do with the response; the lib helpers ship consistent error shapes (HttpError) and JSON/text decoding.',
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee
        // Only flag direct `fetch(...)` calls (Identifier callee).
        if (callee.type !== 'Identifier' || callee.name !== 'fetch') {
          return
        }

        // Skip if `fetch` is locally shadowed by a parameter / declaration.
        // Best-effort: check the scope chain.
        const scope = context.getScope ? context.getScope() : undefined
        if (scope) {
          const variable = scope.references.find(
            ref => ref.identifier === callee,
          )?.resolved
          if (variable && variable.scope.type !== 'global') {
            return
          }
        }

        context.report({
          node,
          messageId: 'banned',
        })
      },
    }
  },
}

export default rule
