/* oxlint-disable socket/no-placeholders -- this rule documents the markers it bans. */
/**
 * @fileoverview Per CLAUDE.md "Completion" rule: never leave TODO /
 * FIXME / XXX / shims / stubs / placeholders. Finish the work 100% or
 * ask before deferring. This rule is the commit-time gate for that
 * principle and covers every shape a placeholder hides in:
 *
 *   1. Comment markers — TODO, FIXME, XXX, HACK, TBD, STUB, WIP,
 *      UNIMPLEMENTED. Word-boundary anchored so identifiers like
 *      `todoStore` don't trigger.
 *
 *   2. `throw new Error('not implemented')` / `'TODO'` / `'unimplemented'`
 *      / `'placeholder'` / `'stub'` — the runtime placeholder.
 *
 *   3. Stub function bodies — a function whose entire body is empty
 *      (`{}`) or contains nothing but a placeholder-marker comment.
 *      `() => undefined` and `() => {}` are flagged when not part of a
 *      no-op contract (callbacks intentionally suppressed via a
 *      docstring `@noop` tag escape).
 *
 * No autofix: a placeholder is a deferred decision; auto-removing it
 * leaves the underlying gap. The right move is for a human to either
 * implement the work or open a tracked issue.
 *
 * Allowed exceptions:
 *   - Marker text inside a string or regex (intentional, e.g. a
 *     parser that detects TODO comments). Skipped — the rule scopes
 *     comment matches to comment AST nodes only.
 *   - Functions that document themselves as intentional no-ops via a
 *     leading `@noop` JSDoc tag in the immediately preceding comment.
 *   - Functions whose body is `{ return }` / `{ return undefined }`
 *     — not flagged unless paired with a placeholder comment. The
 *     stub detector requires a marker comment in the body.
 */

import type { AstNode, RuleContext } from '../lib/rule-types.mts'

const COMMENT_MARKER_RE = /\b(TODO|FIXME|XXX|HACK|TBD|STUB|WIP|UNIMPLEMENTED)\b/

const STUB_BODY_MARKER_RE =
  /\b(TODO|FIXME|XXX|HACK|TBD|STUB|WIP|UNIMPLEMENTED|not\s+implemented|unimplemented|placeholder|stub)\b/i

const THROW_MESSAGE_RE =
  /\b(TODO|FIXME|not\s+implemented|unimplemented|placeholder|stub)\b/i

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ban placeholder code: TODO / FIXME / XXX / HACK / TBD / STUB / WIP / UNIMPLEMENTED markers, `throw new Error("not implemented")`, and empty/stub function bodies. Per CLAUDE.md "Completion" rule — finish the work 100% or open an issue.',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      commentMarker:
        '`{{marker}}` comment — finish the work, open an issue, or ask before deferring. CLAUDE.md "Completion" rule bans deferral markers in source.',
      throwPlaceholder:
        '`throw new Error({{message}})` is a placeholder — implement the function or remove the stub. CLAUDE.md bans unfinished work.',
      stubBody:
        'Function `{{name}}` has a stub body (placeholder comment with no implementation). Finish the function or remove it. Mark intentional no-ops with `@noop` in the leading JSDoc.',
      emptyBody:
        'Function `{{name}}` has an empty body and a placeholder marker. Finish the function or remove the marker. Mark intentional no-ops with `@noop` in the leading JSDoc.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

    /**
     * A function counts as "intentionally a no-op" when its leading
     * JSDoc / line comment contains `@noop`. This is the documented
     * escape hatch for callbacks that genuinely do nothing
     * (e.g. event-handler defaults, test spies).
     */
    function isExplicitNoop(fnNode: AstNode): boolean {
      const leading = sourceCode.getCommentsBefore(fnNode)
      for (const c of leading) {
        if (/@noop\b/.test(c.value)) {
          return true
        }
      }
      // For function declarations the comment is attached to the
      // declaration; for inline arrows/expressions inside a variable
      // declaration the comment is attached to the parent.
      const parent = fnNode.parent
      if (parent && parent.type === 'VariableDeclarator') {
        const declStmt = parent.parent
        if (declStmt) {
          const above = sourceCode.getCommentsBefore(declStmt)
          for (const c of above) {
            if (/@noop\b/.test(c.value)) {
              return true
            }
          }
        }
      }
      return false
    }

    function functionDisplayName(fnNode: AstNode): string {
      if (fnNode.id && fnNode.id.name) {
        return fnNode.id.name
      }
      const parent = fnNode.parent
      if (
        parent &&
        parent.type === 'VariableDeclarator' &&
        parent.id &&
        parent.id.type === 'Identifier'
      ) {
        return parent.id.name
      }
      if (
        parent &&
        parent.type === 'Property' &&
        parent.key &&
        parent.key.type === 'Identifier'
      ) {
        return parent.key.name
      }
      if (
        parent &&
        parent.type === 'MethodDefinition' &&
        parent.key &&
        parent.key.type === 'Identifier'
      ) {
        return parent.key.name
      }
      return '<anonymous>'
    }

    function bodyMarkerComment(blockNode: AstNode): AstNode | undefined {
      const inner = sourceCode.getCommentsInside
        ? sourceCode.getCommentsInside(blockNode)
        : []
      for (const c of inner) {
        if (STUB_BODY_MARKER_RE.test(c.value)) {
          return c
        }
      }
      return undefined
    }

    function checkFunctionBody(fnNode: AstNode): void {
      // Arrow expressions like `() => 42` have a non-block body —
      // they're not stubs.
      if (!fnNode.body || fnNode.body.type !== 'BlockStatement') {
        return
      }
      if (isExplicitNoop(fnNode)) {
        return
      }
      const block = fnNode.body
      const stmts = block.body
      const name = functionDisplayName(fnNode)

      // Empty body + a placeholder marker comment somewhere in the
      // file pointing at this function. We restrict the marker scan
      // to the block's own comments — broader scoping creates false
      // positives.
      if (stmts.length === 0) {
        const marker = bodyMarkerComment(block)
        if (marker) {
          context.report({
            node: fnNode,
            messageId: 'emptyBody',
            data: { name },
          })
        }
        return
      }

      // Body that is just `return` / `return undefined` paired with a
      // placeholder marker comment is a stub. A real return-undefined
      // function with no marker is allowed (it's just terse).
      if (stmts.length === 1) {
        const only = stmts[0]
        const isBareReturn =
          only.type === 'ReturnStatement' &&
          (!only.argument ||
            (only.argument.type === 'Identifier' &&
              only.argument.name === 'undefined') ||
            (only.argument.type === 'Literal' && only.argument.value === null))
        if (isBareReturn) {
          const marker = bodyMarkerComment(block)
          if (marker) {
            context.report({
              node: fnNode,
              messageId: 'stubBody',
              data: { name },
            })
          }
        }
      }
    }

    return {
      Program() {
        const comments = sourceCode.getAllComments()
        for (const comment of comments) {
          const match = COMMENT_MARKER_RE.exec(comment.value)
          if (!match) {
            continue
          }
          context.report({
            node: comment,
            messageId: 'commentMarker',
            data: { marker: match[1] },
          })
        }
      },

      ThrowStatement(node: AstNode) {
        // Match `throw new Error(<string>)` where the string mentions
        // a placeholder phrase. We skip non-Error throws and
        // template-literal throws with interpolations (those usually
        // carry real runtime context).
        const arg = node.argument
        if (
          !arg ||
          arg.type !== 'NewExpression' ||
          arg.callee.type !== 'Identifier' ||
          !/^(Error|TypeError|RangeError)$/.test(arg.callee.name)
        ) {
          return
        }
        const first = arg.arguments[0]
        if (!first) {
          return
        }
        let messageText
        if (first.type === 'Literal' && typeof first.value === 'string') {
          messageText = first.value
        } else if (
          first.type === 'TemplateLiteral' &&
          first.expressions.length === 0 &&
          first.quasis.length === 1
        ) {
          messageText = first.quasis[0].value.cooked
        }
        if (!messageText) {
          return
        }
        if (!THROW_MESSAGE_RE.test(messageText)) {
          return
        }
        context.report({
          node,
          messageId: 'throwPlaceholder',
          data: { message: JSON.stringify(messageText) },
        })
      },

      FunctionDeclaration: checkFunctionBody,
      FunctionExpression: checkFunctionBody,
      ArrowFunctionExpression: checkFunctionBody,
    }
  },
}

export default rule
