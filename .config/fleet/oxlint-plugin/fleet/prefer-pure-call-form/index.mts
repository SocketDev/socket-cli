/*
 * @file Flag `/*@__PURE__*\/` and `/*@__NO_SIDE_EFFECTS__*\/` magic comments
 *   that are NOT directly attached to a CallExpression / NewExpression.
 *   Rolldown (and Terser/esbuild before it) only treats the magic when it sits
 *   immediately before a call:
 *
 *   ```ts
 *   const x = /*@__PURE__*\/ foo()
 *   ```
 *
 *   In any other position the bundler silently ignores the hint, and the value
 *   the user wanted treated as side-effect-free is kept live in the output —
 *   tree-shaking regresses without warning. This rule catches the failure modes
 *   we've seen oxfmt produce in practice:
 *
 *   - Comment on a `class X {}` declaration (oxfmt re-flows it onto the class,
 *     where it has no effect): `/*@__PURE__*\/ class Logger {}`.
 *   - Comment outside parenthesized expressions where the call lives inside:
 *     `const x = /*@__PURE__*\/ (foo()).bar` — the magic is detached from the
 *     call site by the parens / member expression.
 *   - Comment on a bare identifier reference: `const ctor = /*@__PURE__*\/
 *     SomeClass` (no parens means no call; the hint does nothing). Report-only
 *     — the right rewrite is "put the comment immediately before the call, like
 *     `const x = /*@__PURE__*\/ foo()`," and oxfmt's tendency to move comments
 *     back makes any literal autofix a moving target. The rule writes the call
 *     site location and leaves the human to either reposition the comment or
 *     restructure the surrounding code (the documented workaround: introduce an
 *     intermediate const so the magic comment lands adjacent to the call, e.g.
 *     `const tmp = /*@__PURE__*\/ foo(); const x = tmp.bar`).
 */

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

const PURE_MAGIC_RE = /^\s*@(?:__NO_SIDE_EFFECTS__|__PURE__)\s*$/

function isMagicCommentText(raw: string | undefined): boolean {
  if (!raw) {
    return false
  }
  return PURE_MAGIC_RE.test(raw)
}

function commentRange(c: AstNode): [number, number] | undefined {
  const r = c.range
  if (!Array.isArray(r) || r.length !== 2) {
    return undefined
  }
  return [r[0], r[1]]
}

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        '`/*@__PURE__*/` / `/*@__NO_SIDE_EFFECTS__*/` magic comments only affect the bundler when they sit directly before a CallExpression or NewExpression. Detached comments silently regress tree-shaking.',
      category: 'Possible Errors',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      detachedPureComment:
        '`{{kind}}` magic comment is not attached to a CallExpression / NewExpression — the bundler ignores it and the value stays live in the output. Move the comment to immediately before the call, e.g. `const x = {{kind}} foo()`; if the call is buried in a member or parenthesized expression, introduce an intermediate `const tmp = {{kind}} foo()` so the comment can land adjacent.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

    // Source-text approach. After the magic comment, the next
    // syntactically significant token must form a call shape:
    //   - `<identifier>(`        — bare or qualified call
    //   - `<identifier>.<chain>` — qualified call (validated by the
    //     parser via the eventual `(`)
    //   - `new <identifier>(`    — constructor call
    // Anything else (`class`, a parenthesized group like `(foo()).x`,
    // a bare identifier reference with no parens, etc.) means the
    // bundler will discard the hint.
    //
    // Why not use the AST: the failure modes we care about
    // (oxfmt placing the comment on a `class` decl, or outside
    // parens) all show up as syntactically valid programs where the
    // comment is just floating; the AST visitor doesn't make it
    // obvious that the comment isn't on a call node. The textual
    // shape is what the bundler ultimately reads.

    return {
      Program() {
        const comments =
          (sourceCode.getAllComments && sourceCode.getAllComments()) || []
        const text = sourceCode.getText()
        for (let i = 0, { length } = comments; i < length; i += 1) {
          const c = comments[i]
          if (!c || c.type !== 'Block') {
            continue
          }
          if (!isMagicCommentText(c.value)) {
            continue
          }
          const cRange = commentRange(c)
          if (!cRange) {
            continue
          }
          const tail = text.slice(cRange[1])
          // Strip leading whitespace (\n included). Anchor matching
          // on what follows.
          const stripped = tail.replace(/^\s+/, '')
          // Attached shapes:
          //   foo(             — direct call
          //   foo.bar(         — qualified call (no parens before `.`)
          //   new Foo(         — constructor call
          //   foo<T>(          — TS generic call
          //   foo?.(           — optional call
          const attachedRe =
            /^(?:new\s+)?[A-Za-z_$][\w$]*(?:(?:\.|\?\.)[A-Za-z_$][\w$]*)*(?:<[^<>]*>)?(?:\(|\?\.\()/
          if (attachedRe.test(stripped)) {
            continue
          }
          /* c8 ignore next */
          const ct = c.value || ''
          const kind = /__NO_SIDE_EFFECTS__/.test(ct)
            ? '/*@__NO_SIDE_EFFECTS__*/'
            : '/*@__PURE__*/'
          context.report({
            node: c,
            messageId: 'detachedPureComment',
            data: { kind },
          })
        }
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
