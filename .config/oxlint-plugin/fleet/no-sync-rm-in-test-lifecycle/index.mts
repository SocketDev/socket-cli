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

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

const LIFECYCLE_HOOK_NAMES = new Set([
  'afterAll',
  'afterEach',
  'beforeAll',
  'beforeEach',
])

const SYNC_FS_METHODS = new Set(['rmSync', 'rmdirSync', 'unlinkSync'])

const FS_OBJECT_NAMES = /^(fs|fsPromises|fsp|promises)$/

export function calleeKind(
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

/**
 * Walk up from `node` to the nearest enclosing function. If that function is
 * the first argument of a `afterEach`/`afterAll`/`beforeEach`/`beforeAll` call
 * (i.e. the hook's callback), return the hook name; otherwise undefined. Only
 * the IMMEDIATE enclosing function counts — a sync delete nested inside a
 * helper that the hook happens to call is out of scope (matches the old
 * enter/exit-stack behavior, which only pushed the hook's own callback).
 */
export function enclosingLifecycleHook(node: AstNode): string | undefined {
  let current: AstNode = node
  while (current) {
    const parent: AstNode = current.parent
    if (!parent) {
      return undefined
    }
    if (
      parent.type === 'ArrowFunctionExpression' ||
      parent.type === 'FunctionDeclaration' ||
      parent.type === 'FunctionExpression'
    ) {
      // Found the nearest enclosing function. Is it a lifecycle-hook callback?
      const fnParent: AstNode = parent.parent
      if (
        fnParent?.type === 'CallExpression' &&
        fnParent.callee?.type === 'Identifier' &&
        LIFECYCLE_HOOK_NAMES.has(fnParent.callee.name ?? '') &&
        Array.isArray(fnParent.arguments) &&
        fnParent.arguments[0] === parent
      ) {
        return fnParent.callee.name
      }
      // Enclosed by a non-hook function — the sync delete isn't directly in a
      // lifecycle slot.
      return undefined
    }
    current = parent
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
    return {
      CallExpression(node: AstNode) {
        const cal = (node as { callee?: AstNode | undefined }).callee
        if (!cal) {
          return
        }
        const kind = calleeKind(cal)
        if (!kind) {
          return
        }
        // Walk up to the nearest enclosing function; if it's the first-arg
        // callback of a lifecycle-hook call (`afterEach(() => { ... })`), this
        // sync delete is inside a lifecycle slot. Ancestor-walk instead of an
        // enter/exit hook stack so the rule doesn't depend on the `:exit`
        // esquery pseudo, which the oxlint JS-plugin engine doesn't support at
        // the catalog-pinned version.
        const hook = enclosingLifecycleHook(node)
        if (!hook) {
          return
        }
        context.report({
          node,
          messageId: 'syncDelete',
          data: { callee: kind.text, hook },
        })
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
