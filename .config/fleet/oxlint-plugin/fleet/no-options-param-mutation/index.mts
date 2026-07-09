/*
 * @file Flags assignments to properties of a parameter named `options` or
 *   `opts` inside function bodies — the shape that causes silent shared-object
 *   mutation. The canonical incident: a helper's `options` parameter was the
 *   SAME object shared across callers; direct property writes (`options.x = y`)
 *   poisoned the caller's original config without any indication at the call
 *   site. Alphabetical re-sorting of the helper's own sibling list made the
 *   mutation ordering load-bearing, turning a latent bug into a runtime fault.
 *
 *   The fix is a spread-copy local: `const merged = { ...options, x: y }` (or
 *   the null-proto variant `{ __proto__: null, ...options, x: y }` per the
 *   `options-null-proto` rule). Autofix is withheld because:
 *
 *   1. The correct merge point may not be the first assignment — the function
 *      may read `options.x` before writing it, so a hoisted spread-copy would
 *      snapshot a value the function expects to be mutable later.
 *   2. Multiple mutations (`options.x = …; options.y = …`) are best collapsed
 *      into one spread, not individually wrapped — a mechanical per-site fix
 *      generates worse code than a human restructuring the function.
 *   3. A write inside a conditional (`if (x) options.x = y`) needs deliberate
 *      placement of the merge point that depends on the surrounding logic.
 *
 *   Report-only: the message names the spread-copy fix, and the author applies
 *   it with full context. Bypass: a `socket-lint: allow options-param-mutation`
 *   comment on or above the assignment.
 */

import { makeBypassChecker } from '../../lib/comment-markers.mts'
import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

const BYPASS_RE = /socket-lint:\s*allow\s+options-param-mutation/

const WATCHED_PARAM_NAMES = new Set(['options', 'opts'])

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'No direct property writes to an `options`/`opts` param — mutating a shared config object corrupts callers. Use a spread-copy local instead: `const merged = { ...options, x: y }`.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      mutated:
        "`{{name}}.{{prop}}` is a direct write to the `{{name}}` param — the caller's object is mutated in place. Use a spread-copy local instead: `const merged = { ...{{name}}, {{prop}}: <value> }` (or the null-proto form per `options-null-proto`). Bypass: add a `socket-lint: allow options-param-mutation` comment.",
    },
    schema: [],
  },

  create(context: RuleContext) {
    const hasBypassComment = makeBypassChecker(context, BYPASS_RE)

    // Track which param names are options/opts in the current function scope.
    // Each frame also records locals that re-declare a watched name, so a
    // `const options = …` inside a nested function shadows the enclosing param
    // instead of being misattributed to it. A stack keeps nested functions
    // with their own options param independent.
    const scopeStack: Array<{ locals: Set<string>; params: Set<string> }> = []

    function enterFunction(node: AstNode): void {
      const params = node.params
      const watchedNames = new Set<string>()
      if (Array.isArray(params)) {
        for (let i = 0, { length } = params; i < length; i += 1) {
          const p = params[i]
          if (p?.type === 'Identifier' && WATCHED_PARAM_NAMES.has(p.name)) {
            watchedNames.add(p.name)
          }
        }
      }
      scopeStack.push({ locals: new Set(), params: watchedNames })
    }

    function exitFunction(): void {
      scopeStack.pop()
    }

    function checkAssignment(node: AstNode): void {
      // Only interested in assignments whose left side is `options.prop` or
      // `opts.prop` (a MemberExpression with a watched object name).
      const left = node.left
      if (left?.type !== 'MemberExpression') {
        return
      }
      const obj = left.object
      if (obj?.type !== 'Identifier') {
        return
      }
      // Is this identifier one of the watched param names in the current scope?
      const name = obj.name as string
      if (!WATCHED_PARAM_NAMES.has(name)) {
        return
      }
      // Walk the scope stack from innermost outward — the first scope that
      // declares this name owns it.
      for (let i = scopeStack.length - 1; i >= 0; i -= 1) {
        const scope = scopeStack[i]!
        // A local re-declaration shadows the param — the write targets the
        // local, not a caller's object. Stop looking outward.
        if (scope.locals.has(name)) {
          return
        }
        if (scope.params.has(name)) {
          // It's a param in an enclosing (or current) function — report it.
          if (hasBypassComment(node)) {
            return
          }
          const prop = left.computed
            ? '<computed>'
            : (left.property?.name ?? left.property?.value ?? '?')
          context.report({
            node,
            messageId: 'mutated',
            data: { name, prop: String(prop) },
          })
          return
        }
      }
    }

    function recordLocal(node: AstNode): void {
      const id = node.id
      if (
        id?.type === 'Identifier' &&
        WATCHED_PARAM_NAMES.has(id.name) &&
        scopeStack.length > 0
      ) {
        scopeStack[scopeStack.length - 1]!.locals.add(id.name)
      }
    }

    return {
      FunctionDeclaration: enterFunction,
      'FunctionDeclaration:exit': exitFunction,
      FunctionExpression: enterFunction,
      'FunctionExpression:exit': exitFunction,
      ArrowFunctionExpression: enterFunction,
      'ArrowFunctionExpression:exit': exitFunction,
      AssignmentExpression: checkAssignment,
      VariableDeclarator: recordLocal,
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
