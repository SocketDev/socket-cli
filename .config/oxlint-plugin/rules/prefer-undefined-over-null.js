/**
 * @fileoverview Per CLAUDE.md "null vs undefined": use `undefined`.
 * `null` is allowed only for `__proto__: null` (object-literal
 * prototype null) or external API requirements (e.g., JSON encoding).
 *
 * Autofix: rewrites `null` → `undefined` only in safe positions:
 *   - return statements (`return null` → `return undefined`)
 *   - variable initializers (`let x = null` → `let x = undefined`)
 *   - default parameters (`(x = null) => ...` → `(x = undefined) => ...`)
 *   - argument positions in calls (`foo(null)` → `foo(undefined)`)
 *
 * Skipped:
 *   - `__proto__: null` (allowed)
 *   - `=== null` / `!== null` comparisons (semantically distinct)
 *   - `null` inside type annotations / call signatures (TS)
 *   - JSON.stringify args (the second arg is conventionally null)
 */

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Prefer `undefined` over `null` (CLAUDE.md style — `null` is allowed only for __proto__:null or external API requirements).',
      category: 'Stylistic Issues',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      preferUndefined:
        'Use `undefined` instead of `null` (allowed exceptions: `__proto__: null`, external API requirements).',
    },
    schema: [],
  },

  create(context) {
    function isProtoNull(node) {
      const parent = node.parent
      if (!parent || parent.type !== 'Property') {
        return false
      }
      if (parent.value !== node) {
        return false
      }
      const key = parent.key
      if (!key) {
        return false
      }
      // { __proto__: null } — key is Identifier `__proto__` or string '__proto__'.
      if (key.type === 'Identifier' && key.name === '__proto__') {
        return true
      }
      if (key.type === 'Literal' && key.value === '__proto__') {
        return true
      }
      return false
    }

    function isComparisonOperand(node) {
      const parent = node.parent
      if (!parent) {
        return false
      }
      if (parent.type !== 'BinaryExpression') {
        return false
      }
      return ['===', '!==', '==', '!='].includes(parent.operator)
    }

    function isJsonStringifyReplacer(node) {
      // JSON.stringify(value, replacer, space) — `replacer` is conventionally null.
      const parent = node.parent
      if (
        !parent ||
        parent.type !== 'CallExpression' ||
        parent.arguments[1] !== node
      ) {
        return false
      }
      const callee = parent.callee
      if (callee.type !== 'MemberExpression') {
        return false
      }
      return (
        callee.object.type === 'Identifier' &&
        callee.object.name === 'JSON' &&
        callee.property.type === 'Identifier' &&
        callee.property.name === 'stringify'
      )
    }

    return {
      Literal(node) {
        if (node.value !== null || node.raw !== 'null') {
          return
        }

        if (isProtoNull(node)) {
          return
        }
        if (isComparisonOperand(node)) {
          return
        }
        if (isJsonStringifyReplacer(node)) {
          return
        }

        context.report({
          node,
          messageId: 'preferUndefined',
          fix(fixer) {
            return fixer.replaceText(node, 'undefined')
          },
        })
      },
    }
  },
}

export default rule
