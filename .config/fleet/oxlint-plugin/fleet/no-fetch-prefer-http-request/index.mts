/*
 * @file Per CLAUDE.md "HTTP — never `fetch()`. Use httpJson / httpText /
 *   httpRequest from @socketsecurity/lib-stable/http-request." Reports any
 *   `fetch(...)` call (global fetch). Does NOT auto-fix because the right
 *   replacement (`httpJson` vs `httpText` vs `httpRequest`) depends on what the
 *   caller does with the response — a wrong autofix would silently change
 *   behavior. Reporting only. Allowed exceptions (skipped):
 *
 *   - `globalThis.fetch` — explicit reference (often for monkey-patching in
 *     tests).
 *   - Method calls (`obj.fetch(...)`) — those aren't the global.
 */

/**
 * @type {import('eslint').Rule.RuleModule}
 */

import { makeBypassChecker } from '../../lib/comment-markers.mts'
import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

// socket-lint: allow global-fetch -- opt-out for a `fetch()` that genuinely
// must use the platform global (e.g. publish / provenance tooling probing a
// registry before the lib http-request helper is available).
const BYPASS_RE = /socket-lint:\s*allow\s+global-fetch/

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Use httpJson / httpText / httpRequest from @socketsecurity/lib-stable/http-request instead of global fetch().',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      banned:
        'global fetch() — use httpJson / httpText / httpRequest from @socketsecurity/lib-stable/http-request. The right replacement depends on what you do with the response; the lib helpers ship consistent error shapes (HttpError) and JSON/text decoding.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const hasBypassComment = makeBypassChecker(context, BYPASS_RE)
    return {
      CallExpression(node: AstNode) {
        const callee = node.callee
        // Only flag direct `fetch(...)` calls (Identifier callee).
        if (callee.type !== 'Identifier' || callee.name !== 'fetch') {
          return
        }
        if (hasBypassComment(node)) {
          return
        }

        // Skip if `fetch` is locally shadowed by a parameter / declaration.
        // Best-effort: check the scope chain.
        const scope = context.getScope ? context.getScope() : undefined
        if (scope) {
          const variable = scope.references.find(
            (ref: AstNode) => ref.identifier === callee,
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

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
