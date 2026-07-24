/*
 * @file Enforce the fleet guard contract on a hook that opts into it. A guard
 *   that imports the contract helpers from `_shared/guard.mts` (bashGuard /
 *   editGuard / runGuard / block / notify) runs IN-PROCESS under the per-event
 *   dispatcher (`_shared/dispatch.mts`) — so two things break it:
 *
 *   - `process.exit(...)` — a hard exit kills the dispatcher mid-loop, silently
 *     skipping every guard registered after it (a security hole). A guard
 *     signals a block by RETURNING `block(msg)` (exitCode 2), never by
 *     exiting.
 *   - a `process.argv[1]` entrypoint gate — it misfires when the dispatcher
 *     imports the module (argv[1] is the dispatcher, not the guard). The
 *     standalone-vs-dispatched decision lives in `runGuard(check,
 *     import.meta.url)`, not a hand-rolled argv check. Scope: only
 *     `.claude/hooks/**∕index.mts` files that import `guard.mts` — a pure
 *     side-effect hook (output transformer, installer, sweeper) that does NOT
 *     import the contract is exempt and may exit normally. Pairs with
 *     `gen/hook-dispatch.mts`'s conformance classifier + the `creating-guards`
 *     skill. No autofix — removing an exit / argv gate is a structural
 *     rewrite.
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

function isProcessMember(node: AstNode, name: string): boolean {
  return (
    node?.type === 'MemberExpression' &&
    !node.computed &&
    node.object?.type === 'Identifier' &&
    node.object.name === 'process' &&
    node.property?.type === 'Identifier' &&
    node.property.name === name
  )
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'A guard using the _shared/guard.mts contract must not call process.exit or gate on process.argv[1] — both break the per-event dispatcher.',
      category: 'Possible Errors',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      processExit:
        'A contract guard must not call `process.exit()` — in the shared dispatcher a hard exit silently skips every later guard. Return `block(message)` / `notify(message)` / `undefined` instead.',
      argvGate:
        'A contract guard must not gate on `process.argv[1]` — it misfires when the dispatcher imports the module. End the file with `await runGuard(check, import.meta.url)`, which handles the standalone-vs-dispatched decision.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const filename = context.filename ?? context.getFilename?.() ?? ''
    const normalized = normalizePath(filename)
    // Only hook entrypoints, and never the shared libs or tests.
    if (
      !/(?:^|\/)\.claude\/hooks\/.+\/index\.mts$/.test(normalized) ||
      /\/_shared\//.test(normalized) ||
      /\/test\//.test(normalized) ||
      /\.test\.[mc]?[jt]s$/.test(normalized)
    ) {
      return {}
    }
    // The contract import is at the top of the file, so it is visited before any
    // process.exit / argv use below it — report inline once the flag is set.
    let importsContract = false
    return {
      ImportDeclaration(node: AstNode) {
        const source = node.source?.value
        if (typeof source === 'string' && /(?:^|\/)guard\.mts$/.test(source)) {
          importsContract = true
        }
      },
      CallExpression(node: AstNode) {
        if (importsContract && isProcessMember(node.callee, 'exit')) {
          context.report({ node, messageId: 'processExit' })
        }
      },
      MemberExpression(node: AstNode) {
        // process.argv[1]
        if (
          importsContract &&
          node.computed &&
          node.property?.type === 'Literal' &&
          node.property.value === 1 &&
          isProcessMember(node.object, 'argv')
        ) {
          context.report({ node, messageId: 'argvGate' })
        }
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
