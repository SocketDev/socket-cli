/**
 * @file The fleet sync spawn (`spawnSync` from
 *   `@socketsecurity/lib-stable/process/spawn/child`) returns node's
 *   `SpawnSyncReturns`, whose exit code lives on `.status` (an `.signal`
 *   sibling), NOT `.code`. Reading `.code` off a `spawnSync(...)` result is
 *   ALWAYS `undefined` — a silent false-green: a guard like `if
 *   (spawnSync(...).code !== 0)` never fires, so a failed child reads as
 *   success. (This is not theoretical — it caused the markdown-filenames
 *   check to false-green until fixed in 32e0bf93.) The ASYNC `spawn(...)`
 *   wrapper is different: it rejects on non-zero exit with an error carrying
 *   `.code`, so `.code` is correct THERE — this rule scopes strictly to
 *   values that come from `spawnSync(...)`, both the inline
 *   `spawnSync(...).code` and a tracked binding (`const r = spawnSync(...);
 *   r.code`). `.status` / computed access (`r['code']`) / `.code` on anything
 *   not from spawnSync are left alone. Report-only (the fix is `.status`, but
 *   a rename autofix would need to be sure the receiver is a spawnSync result
 *   at every site — the human confirms). Bypass: a `socket-lint: allow
 *   spawnsync-code-field` comment on or just above the flagged line.
 */

import { makeBypassChecker } from '../../lib/comment-markers.mts'
import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

const ALLOW_RE = /socket-lint:\s*allow\s+spawnsync-code-field/

// The always-undefined property. node's SpawnSyncReturns exposes the exit code
// as `.status`; `.code` is the async-spawn error shape, never on a sync result.
const BAD_PROP = 'code'

// Nearest enclosing function boundary (or Program) — the lexical bucket a
// binding lives in. Mock nodes without a parent chain (in-process tests) fall
// into one shared `undefined` bucket, degrading to file-wide tracking.
function enclosingScope(node: AstNode | undefined): AstNode | undefined {
  let current = node?.parent
  while (current) {
    const t = current.type
    if (
      t === 'ArrowFunctionExpression' ||
      t === 'FunctionDeclaration' ||
      t === 'FunctionExpression' ||
      t === 'Program'
    ) {
      return current
    }
    current = current.parent
  }
  return undefined
}

// Is this a `spawnSync(...)` call — the fleet sync wrapper (or node's, both
// return SpawnSyncReturns)? Match the callee NAME `spawnSync`, bare
// (`spawnSync(...)`) or member (`childProcess.spawnSync(...)`).
function isSpawnSyncCall(node: AstNode | undefined): boolean {
  if (!node || node.type !== 'CallExpression') {
    return false
  }
  const callee = node.callee
  if (!callee) {
    return false
  }
  if (callee.type === 'Identifier') {
    return callee.name === 'spawnSync'
  }
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property?.type === 'Identifier'
  ) {
    return callee.property.name === 'spawnSync'
  }
  return false
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Do not read `.code` off a `spawnSync(...)` result — SpawnSyncReturns carries the exit code on `.status`, so `.code` is always undefined (silent false-green). Use `.status`.',
      category: 'Possible Errors',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      spawnsyncCodeField:
        '`.code` on a `spawnSync(...)` result is ALWAYS undefined — node`s SpawnSyncReturns carries the exit code on `.status` (`.code` is the async `spawn(...)` error shape). Reading it is a silent false-green: a `!== 0` guard never fires. Use `.status` instead (and `.signal` for a kill signal).',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const hasBypassComment = makeBypassChecker(context, ALLOW_RE)
    // Identifiers bound to a `spawnSync(...)` call (`const r = spawnSync(...)`),
    // bucketed by enclosing function scope. A file-wide set cross-contaminates
    // sibling functions: one function's `const r = spawnSync(...)` must not
    // taint a sibling's `const r = await spawn(...)`, whose `.code` IS the
    // correct field (async rejection shape).
    const spawnSyncNamesByScope = new Map<AstNode | undefined, Set<string>>()

    // The receiver of a `.code` access is a spawnSync result: an id tracked in
    // the receiver's scope chain (a closure may read an outer function's
    // result), or an inline `spawnSync(...)` call.
    function isSpawnSyncResult(node: AstNode | undefined): boolean {
      if (!node) {
        return false
      }
      if (node.type === 'Identifier') {
        let scope = enclosingScope(node)
        for (;;) {
          if (spawnSyncNamesByScope.get(scope)?.has(node.name)) {
            return true
          }
          if (!scope) {
            return false
          }
          scope = enclosingScope(scope)
        }
      }
      return isSpawnSyncCall(node)
    }

    return {
      VariableDeclarator(node: AstNode) {
        const id = node.id
        const init = node.init
        if (id?.type === 'Identifier' && isSpawnSyncCall(init)) {
          const scope = enclosingScope(node)
          let names = spawnSyncNamesByScope.get(scope)
          if (!names) {
            names = new Set<string>()
            spawnSyncNamesByScope.set(scope, names)
          }
          names.add(id.name)
        }
      },
      MemberExpression(node: AstNode) {
        if (
          node.computed ||
          node.property?.type !== 'Identifier' ||
          node.property.name !== BAD_PROP
        ) {
          return
        }
        if (!isSpawnSyncResult(node.object)) {
          return
        }
        if (hasBypassComment(node)) {
          return
        }
        context.report({
          node,
          messageId: 'spawnsyncCodeField',
        })
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
