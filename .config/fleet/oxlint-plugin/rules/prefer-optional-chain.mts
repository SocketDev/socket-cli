/**
 * @file Flag the `a && a.b` / `a && a.b()` / `x.y && x.y.z` guard-then-access
 *   pattern and prefer optional chaining (`a?.b`, `a?.b()`, `x.y?.z`). The
 *   guard-then-access idiom repeats the operand purely to null-check it before
 *   a member access or call; `?.` says the same thing in one operand and reads
 *   at a glance. The motivating fleet case is every hook's entrypoint guard —
 *   `process.argv[1] && process.argv[1].endsWith('index.mts')` collapses to
 *   `process.argv[1]?.endsWith('index.mts')`. Fires only when the LEFT operand
 *   is textually identical to the base of the RIGHT operand's access chain, so
 *   the rewrite is provably equivalent:
 *
 *   - `a && a.b` → `a?.b`
 *   - `a && a.b()` → `a?.b()`
 *   - `a && a[k]` → `a?.[k]`
 *   - `obj.x && obj.x.y` → `obj.x?.y`
 *   - `a[0] && a[0].f()` → `a[0]?.f()` Skipped (report-only complexity not worth
 *     a fragile fix):
 *   - The left operand is itself optional/chained in a way that the textual
 *     prefix match can't prove equivalent (e.g. `a.b && a.c.b` — different
 *     chains that happen to share a token).
 *   - The right operand's base does not textually equal the left operand.
 *   - A `||` chain (optional chaining is an `&&`-guard transform only). oxlint
 *     ships `typescript/prefer-optional-chain`, but it is a no-op in the
 *     fleet-pinned oxlint (1.63.x) — this rule covers the gap until a bump
 *     enables the built-in, and encodes the fleet's specific entrypoint-guard
 *     convention.
 */

import type { AstNode, RuleContext, RuleFixer } from '../lib/rule-types.mts'

// The base (left-most object) of a member/call access chain. For `a.b.c()` the
// base is `a`; for `a[0].f` the base is `a[0]`'s object `a`. We return the node
// whose text is the guard the left operand must equal — i.e. the object of the
// OUTERMOST member access in `right`.
function outerMemberObject(node: AstNode | undefined): AstNode | undefined {
  if (!node) {
    return undefined
  }
  if (node.type === 'MemberExpression') {
    return node.object
  }
  if (node.type === 'CallExpression') {
    const callee = node.callee
    if (callee && callee.type === 'MemberExpression') {
      return callee.object
    }
  }
  return undefined
}

// The member access node inside `right` whose `.`/`[` joins the guarded base to
// the access — this is the join point that becomes `?.`. For `a.b()` it's the
// `a.b` MemberExpression; for `a.b` it's `a.b` itself.
function joinMember(node: AstNode | undefined): AstNode | undefined {
  if (!node) {
    return undefined
  }
  if (node.type === 'MemberExpression') {
    return node
  }
  if (node.type === 'CallExpression') {
    const callee = node.callee
    if (callee && callee.type === 'MemberExpression') {
      return callee
    }
  }
  return undefined
}

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Prefer optional chaining (`a?.b`) over the `a && a.b` guard-then-access pattern.',
      category: 'Stylistic Issues',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      preferOptionalChain:
        '`{{guard}} && {{guard}}.…` repeats the operand to null-check it. Use optional chaining: `{{guard}}?.…`.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode
    return {
      LogicalExpression(node: AstNode) {
        if (node.operator !== '&&') {
          return
        }
        const { left, right } = node
        const member = joinMember(right)
        const base = outerMemberObject(right)
        if (!member || !base || !left) {
          return
        }
        // Already optional at the join — nothing to do.
        if (member.optional) {
          return
        }
        const guardText = sourceCode.getText(left)
        const baseText = sourceCode.getText(base)
        // The left operand must be exactly the guarded base for the rewrite to
        // be provably equivalent.
        if (guardText !== baseText) {
          return
        }
        context.report({
          node,
          messageId: 'preferOptionalChain',
          data: { guard: guardText },
          fix(fixer: RuleFixer) {
            // Rewrite the whole logical expression to the right operand with the
            // single join `.`/`[` turned into `?.`. Computed member (`a[k]`)
            // becomes `a?.[k]`; named member (`a.b`) becomes `a?.b`.
            const rightText = sourceCode.getText(right)
            const insertAt = baseText.length
            const after = rightText.slice(insertAt)
            // `after` begins with `.` (named) or `[` (computed) — `?.` then the
            // rest, dropping a leading `.` so we don't double it.
            const tail = after.startsWith('.')
              ? `?.${after.slice(1)}`
              : `?.${after}`
            return fixer.replaceText(node, `${baseText}${tail}`)
          },
        })
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
