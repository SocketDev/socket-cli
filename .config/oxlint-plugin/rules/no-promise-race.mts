/**
 * @fileoverview Forbid `Promise.race(...)` outright — fleet style.
 * `Promise.race` resolves with the first settled promise but does not
 * cancel the losers. Every unsettled promise continues to run, hold
 * its handles open, and deliver its result into a `.then` chain that
 * no one consumes. Worse: each call attaches fresh `.then` handlers
 * to every input promise; if the same long-lived promise is raced
 * repeatedly (a common shape: race a pool against successive
 * timeouts), the handler list on that promise grows unboundedly. The
 * memory leak is invisible at the callsite — the leaking promise is
 * upstream — and has been known to V8 / Node.js for years without
 * a fix landing.
 *
 * References:
 *   - https://github.com/nodejs/node/issues/17469 — long-running
 *     `nodejs/node` issue documenting the handler-list growth and
 *     why `Promise.race` is the wrong tool for "wait with timeout".
 *   - https://github.com/cefn/watchable/tree/main/packages/unpromise#readme
 *     — `@watchable/unpromise` is the canonical workaround:
 *     subscribe/unsubscribe to a long-lived promise without
 *     attaching new `.then` handlers per call. Reach for it when
 *     you genuinely need race semantics on a promise you can't
 *     restructure away.
 *
 * Style signal that motivated the rule: across the fleet's six
 * surveyed repos, `Promise.race` appears 3 times total (socket-sdk-js
 * 2, socket-cli 1) — those are stragglers, not a pattern. The fleet
 * already favors cancellation-aware shapes:
 *   - `AbortSignal.timeout(ms)` + `AbortSignal.any([...signals])` for
 *     timeouts and cancellation.
 *   - `Promise.allSettled(...)` when you genuinely want all results.
 *   - `Promise.any(...)` if you only care about the first SUCCESS
 *     (not first SETTLE) — still leaks losers, but at least the
 *     semantics aren't "first error wins".
 *   - `@watchable/unpromise` when racing against a long-lived
 *     promise is unavoidable.
 *
 * `no-promise-race-in-loop` is the narrower sibling rule for the
 * specific "race-in-loop leaks the pool" antipattern. This rule is
 * broader: every `Promise.race(...)` callsite, anywhere.
 *
 * No autofix: the right fix is design-level (introduce an
 * AbortController, await the loser explicitly, switch to
 * `AbortSignal.any` + timeout, or adopt `@watchable/unpromise`).
 * Reporting only.
 */

/** @type {import('eslint').Rule.RuleModule} */

import type { AstNode, RuleContext } from '../lib/rule-types.mts'

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Forbid `Promise.race(...)` — losers keep running and leak handles. Use `AbortSignal.any` + timeout, `Promise.allSettled`, or restructure the wait.',
      category: 'Possible Errors',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      noPromiseRace:
        '`Promise.race(...)` leaves the losing promises pending — they keep their handles, deliver results to no one, and each call attaches new `.then` handlers to every input (handler list grows unboundedly; see nodejs/node#17469). Use `AbortSignal.any([AbortSignal.timeout(ms), userSignal])` for timeouts, `Promise.allSettled` when you need every result, restructure to a single awaited promise, or adopt `@watchable/unpromise` when racing a long-lived promise is unavoidable.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    return {
      CallExpression(node: AstNode) {
        const callee = node.callee
        if (callee.type !== 'MemberExpression') {
          return
        }
        if (
          callee.object.type !== 'Identifier' ||
          callee.object.name !== 'Promise'
        ) {
          return
        }
        if (
          callee.property.type !== 'Identifier' ||
          callee.property.name !== 'race'
        ) {
          return
        }
        context.report({
          node,
          messageId: 'noPromiseRace',
        })
      },
    }
  },
}

export default rule
