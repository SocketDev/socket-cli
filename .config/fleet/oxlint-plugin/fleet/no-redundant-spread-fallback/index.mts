/*
 * @file Flag `...(x ?? {})` and `...(x || {})` inside an OBJECT literal and
 *   fix them to `...x`. Object spread already tolerates every value the
 *   fallback guards against: spreading `undefined`, `null`, a number, or a
 *   boolean contributes no properties, and every falsy value `||` can smuggle
 *   past (`0`, `''`, `false`, `NaN`) spreads to nothing too, so the fallback
 *   object is dead weight that only adds parens and an allocation.
 *
 *   Scoped to ObjectExpression spreads ON PURPOSE: ARRAY spread does NOT
 *   tolerate nullish (`[...undefined]` throws TypeError), so `[...(x ?? [])]`
 *   is load-bearing and never reported. Only an EMPTY object literal fallback
 *   counts — `...(x ?? { retries: 1 })` expresses a real default and stays.
 *
 *   Bypass: a `oxlint-disable-next-line socket/no-redundant-spread-fallback` comment on the
 *   line above, for a spread kept verbose deliberately (e.g. mirrored from an
 *   upstream snippet a diff must track).
 */

import { makeBypassChecker } from '../../lib/comment-markers.mts'
import type { AstNode, RuleContext, RuleFixer } from '../../lib/rule-types.mts'

/**
 * Whether a spread argument is `<left> ?? {}` or `<left> || {}` with an EMPTY
 * object fallback — the shape whose fallback object spread makes redundant.
 * Pure over a minimal node shape so tests drive it without a parser.
 */
export function isRedundantSpreadFallback(argument: AstNode): boolean {
  if (!argument || argument.type !== 'LogicalExpression') {
    return false
  }
  if (argument.operator !== '??' && argument.operator !== '||') {
    return false
  }
  const right = argument.right
  return (
    right?.type === 'ObjectExpression' &&
    Array.isArray(right.properties) &&
    right.properties.length === 0
  )
}

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Object spread tolerates nullish and falsy operands, so `...(x ?? {})` / `...(x || {})` is `...x`.',
      category: 'Stylistic Issues',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      redundantFallback:
        'Object spread already contributes nothing for a nullish or falsy operand - drop the `{{operator}} {}` fallback and spread the operand directly.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode
    const hasBypassComment = makeBypassChecker(
      context,
      'socket/no-redundant-spread-fallback',
    )

    return {
      ObjectExpression(node: AstNode) {
        const properties = node.properties
        if (!Array.isArray(properties)) {
          return
        }
        for (let i = 0, { length } = properties; i < length; i += 1) {
          const property = properties[i] as AstNode
          if (property?.type !== 'SpreadElement') {
            continue
          }
          const argument = property.argument as AstNode
          if (!isRedundantSpreadFallback(argument)) {
            continue
          }
          if (hasBypassComment(property)) {
            continue
          }
          const left = argument.left as AstNode
          context.report({
            node: property,
            messageId: 'redundantFallback',
            data: { operator: String(argument.operator) },
            fix(fixer: RuleFixer) {
              const leftText = sourceCode.getText(left) as string
              return fixer.replaceText(property, `...${leftText}`)
            },
          })
        }
      },
    }
  },
}

// Oxlint plugin contract requires default-exported rule object.
// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract
export default rule
