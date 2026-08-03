/*
 * @file Prefer `Promise.allSettled(...)` over an AWAITED, RESULT-DISCARDED
 *   `Promise.all(...)` batch. When the resolved array is thrown away (the
 *   `await Promise.all(...)` is its own statement), the only behavior difference
 *   from `Promise.allSettled` is aborting the whole batch on the FIRST rejection
 *   — leaving the sibling promises' rejections unhandled (an unhandledRejection
 *   for work that was already in flight). For order-independent concurrent work
 *   you almost always want `allSettled` so one failure does not abandon the
 *   rest; the fleet already uses it for exactly this (cascade-and-land.mts,
 *   run-skill-fleet.mts). Narrow + low-false-positive by design — fires ONLY
 *   when all three hold:
 *
 *   1. the callee is exactly `Promise.all` (not a computed `Promise["all"]`, not
 *      some other object's `.all`);
 *   2. the sole argument is an array literal `[a(), b()]` or an `.map`/`.flatMap`
 *      call — a real concurrency fan-out, not a bare identifier whose contents
 *      we can't see;
 *   3. the result is DISCARDED — `await Promise.all(...)` standing as its own
 *      ExpressionStatement. A consumed result (`const x = await …`, a `return`,
 *      a `.then`/`.catch` chain, a call argument) needs the positional array and
 *      is left alone.
 *
 *   Report-only (no autofix / suggestion): switching to `allSettled` changes the
 *   resolved shape AND the error semantics, so the fix is the author's call. For
 *   a DELIBERATE fail-fast batch, add
 *   `// oxlint-disable-next-line socket/prefer-all-settled -- fail-fast: <reason>`.
 */

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Prefer `Promise.allSettled` over an awaited, result-discarded `Promise.all` — one rejection aborts the batch and leaves sibling rejections unhandled.',
      category: 'Possible Errors',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      preferAllSettled:
        'This awaited `Promise.all(...)` discards its result, so its only effect over `Promise.allSettled` is aborting the whole batch on the first rejection — the sibling promises then reject unhandled. For order-independent work use `Promise.allSettled(...)` so one failure does not abandon the rest. For a deliberate fail-fast batch, add `// oxlint-disable-next-line socket/prefer-all-settled -- fail-fast: <reason>`.',
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
          callee.property.name !== 'all'
        ) {
          return
        }
        // Concurrency signal: the sole arg is an array literal or an .map/.flatMap
        // fan-out — not a bare identifier whose element promises we can't see.
        const arg = node.arguments?.[0]
        if (!arg) {
          return
        }
        const isArray = arg.type === 'ArrayExpression'
        const isMapCall =
          arg.type === 'CallExpression' &&
          arg.callee?.type === 'MemberExpression' &&
          arg.callee.property?.type === 'Identifier' &&
          (arg.callee.property.name === 'flatMap' ||
            arg.callee.property.name === 'map')
        if (!isArray && !isMapCall) {
          return
        }
        // Result-discarded signal: `await Promise.all(...)` standing as its own
        // statement. A consumed result keeps the positional array, so skip it.
        const parent = node.parent
        if (
          parent?.type !== 'AwaitExpression' ||
          parent.parent?.type !== 'ExpressionStatement'
        ) {
          return
        }
        context.report({ node, messageId: 'preferAllSettled' })
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
