/**
 * @file Per CLAUDE.md "Testing — test cleanup": `afterEach` / `afterAll` /
 *   `beforeEach` / `beforeAll` callback bodies must use `await safeDelete(...)`
 *   from `@socketsecurity/lib-stable/fs`. Sync filesystem deletion inside
 *   lifecycle hooks races on Windows EBUSY and has no flush guarantee against
 *   vitest's async-aware teardown ordering. This rule is the narrower
 *   lifecycle-hook check. The broader `prefer-safe-delete` rule already
 *   promotes `safeDeleteSync` as a valid target for arbitrary sync deletes;
 *   THIS rule says even `safeDeleteSync` is wrong inside lifecycle slots.
 *   Detects (inside an immediate `afterEach` / `afterAll` / `beforeEach` /
 *   `beforeAll` call's first-argument callback body):
 *
 *   - `safeDeleteSync(...)`
 *   - `fs.rmSync(...)` / `fs.unlinkSync(...)` / `fs.rmdirSync(...)` Reporting
 *     only — no autofix. The async rewrite needs the enclosing function to be
 *     `async`; doing both the callback-shape rewrite and the call-site rewrite
 *     in a single autofix is fragile (await-vs-no-await, sequencing within the
 *     callback). Authors fix by hand.
 */

import type { AstNode, RuleContext } from '../lib/rule-types.mts'

const LIFECYCLE_HOOK_NAMES = new Set([
  'afterAll',
  'afterEach',
  'beforeAll',
  'beforeEach',
])

const SYNC_FS_METHODS = new Set(['rmSync', 'rmdirSync', 'unlinkSync'])

const FS_OBJECT_NAMES = /^(fs|fsPromises|fsp|promises)$/

function calleeKind(
  callee: AstNode,
):
  | { kind: 'fn'; text: string }
  | { kind: 'fsmethod'; text: string }
  | undefined {
  if (
    callee.type === 'Identifier' &&
    (callee as { name?: string | undefined }).name === 'safeDeleteSync'
  ) {
    return { kind: 'fn', text: 'safeDeleteSync' }
  }
  if (callee.type === 'MemberExpression') {
    const prop = (callee as { property?: AstNode | undefined }).property
    if (!prop || prop.type !== 'Identifier') {
      return undefined
    }
    const propName = (prop as { name?: string | undefined }).name
    if (!propName || !SYNC_FS_METHODS.has(propName)) {
      return undefined
    }
    const obj = (callee as { object?: AstNode | undefined }).object
    const objName =
      obj?.type === 'Identifier'
        ? (obj as { name?: string | undefined }).name
        : obj?.type === 'MemberExpression' &&
            (obj as { property?: AstNode | undefined }).property?.type ===
              'Identifier'
          ? (
              (obj as { property?: { name?: string | undefined } | undefined })
                .property as {
                name?: string | undefined
              }
            ).name
          : undefined
    if (!objName || !FS_OBJECT_NAMES.test(objName)) {
      return undefined
    }
    return { kind: 'fsmethod', text: `${objName}.${propName}` }
  }
  return undefined
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Lifecycle hooks (afterEach / afterAll / beforeEach / beforeAll) must use `await safeDelete(...)`. Sync filesystem deletion races on Windows EBUSY.',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      syncDelete:
        '`{{callee}}` inside `{{hook}}` — use `await safeDelete(...)` from @socketsecurity/lib-stable/fs. Lifecycle hooks race on Windows EBUSY; the async form retries and integrates with vitest async teardown ordering.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const hookStack: string[] = []
    // Side-channel map keyed by AST node identity — avoids mutating the
    // node itself (mutation triggers no-underscore-identifier via the
    // `_lifecycleHookName` field name, and risks colliding with other
    // rules walking the same tree). WeakMap retains nothing past the
    // single rule run.
    const hookNameByCallExpr = new WeakMap<AstNode, string>()

    return {
      CallExpression(node: AstNode) {
        const cal = (node as { callee?: AstNode | undefined }).callee
        if (
          cal?.type === 'Identifier' &&
          LIFECYCLE_HOOK_NAMES.has(
            (cal as { name?: string | undefined }).name ?? '',
          )
        ) {
          const calName = (cal as { name?: string | undefined }).name
          if (calName) {
            hookNameByCallExpr.set(node, calName)
          }
          return
        }

        if (hookStack.length === 0) {
          return
        }

        const kind = calleeKind(cal!)
        if (!kind) {
          return
        }
        context.report({
          node,
          messageId: 'syncDelete',
          data: {
            callee: kind.text,
            hook: hookStack[hookStack.length - 1] ?? 'lifecycle hook',
          },
        })
      },

      'FunctionExpression, ArrowFunctionExpression'(node: AstNode) {
        const parent = (node as unknown as { parent?: AstNode | undefined })
          .parent
        if (!parent || parent.type !== 'CallExpression') {
          return
        }
        const hookName = hookNameByCallExpr.get(parent)
        if (!hookName) {
          return
        }
        const args =
          (parent as { arguments?: AstNode[] | undefined }).arguments ?? []
        if (args[0] === node) {
          hookStack.push(hookName)
        }
      },
      'FunctionExpression:exit, ArrowFunctionExpression:exit'(node: AstNode) {
        const parent = (node as unknown as { parent?: AstNode | undefined })
          .parent
        if (!parent || parent.type !== 'CallExpression') {
          return
        }
        if (!hookNameByCallExpr.has(parent)) {
          return
        }
        const args =
          (parent as { arguments?: AstNode[] | undefined }).arguments ?? []
        if (args[0] === node) {
          hookStack.pop()
        }
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
