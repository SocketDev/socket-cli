/**
 * @fileoverview Per CLAUDE.md "Token hygiene → Socket API token env
 * var" rule:
 *
 *   The canonical fleet name is `SOCKET_API_TOKEN`. The legacy names
 *   `SOCKET_API_KEY`, `SOCKET_SECURITY_API_TOKEN`, and
 *   `SOCKET_SECURITY_API_KEY` are accepted as aliases for one cycle
 *   (deprecation grace period) — bootstrap hooks read all four and
 *   normalize to `SOCKET_API_TOKEN` going forward.
 *
 * Detects string literals naming any of the legacy aliases:
 *   - SOCKET_API_KEY
 *   - SOCKET_SECURITY_API_TOKEN
 *   - SOCKET_SECURITY_API_KEY
 *
 * Autofix: rewrites to `SOCKET_API_TOKEN`. Skipped:
 *   - Lines marked with `socket-api-token-env: bootstrap` adjacent
 *     comment — the alias-normalization code that intentionally reads
 *     all four names. The bootstrap hook is the one place legacy
 *     aliases legitimately appear.
 *   - The literal `SOCKET_CLI_API_TOKEN` — unrelated; that's the
 *     socket-cli configuration setting, not an API token alias.
 */

import type { AstNode, RuleContext, RuleFixer } from '../lib/rule-types.mts'

const LEGACY_ALIASES = new Set([
  'SOCKET_API_KEY',
  'SOCKET_SECURITY_API_TOKEN',
  'SOCKET_SECURITY_API_KEY',
])

const CANONICAL = 'SOCKET_API_TOKEN'

const BYPASS_RE = /socket-api-token-env:\s*bootstrap/

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Use the canonical SOCKET_API_TOKEN env var; rewrite legacy aliases (SOCKET_API_KEY, SOCKET_SECURITY_API_TOKEN, SOCKET_SECURITY_API_KEY).',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      legacy:
        '`{{name}}` is a legacy alias — use `SOCKET_API_TOKEN` (the canonical fleet name). Bootstrap hooks normalize the aliases.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

    function hasBypassComment(node: AstNode) {
      const before = sourceCode.getCommentsBefore(node)
      const after = sourceCode.getCommentsAfter(node)
      for (const c of [...before, ...after]) {
        if (BYPASS_RE.test(c.value)) {
          return true
        }
      }
      return false
    }

    function checkStringValue(node: AstNode, value: string): void {
      // Match exactly; we don't want partial substrings.
      if (!LEGACY_ALIASES.has(value)) {
        return
      }
      if (hasBypassComment(node)) {
        return
      }
      context.report({
        node,
        messageId: 'legacy',
        data: { name: value },
        fix(fixer: RuleFixer) {
          const raw = sourceCode.getText(node)
          const quote = raw[0]
          if (quote === '`') {
            return fixer.replaceText(node, '`' + CANONICAL + '`')
          }
          return fixer.replaceText(node, quote + CANONICAL + quote)
        },
      })
    }

    return {
      Literal(node: AstNode) {
        if (typeof node.value !== 'string') {
          return
        }
        checkStringValue(node, node.value)
      },
      TemplateLiteral(node: AstNode) {
        if (node.expressions.length !== 0) {
          return
        }
        checkStringValue(node, node.quasis[0].value.cooked)
      },
      // Also catch `process.env.SOCKET_API_KEY` (member expression).
      MemberExpression(node: AstNode) {
        if (node.computed) {
          return
        }
        if (node.property.type !== 'Identifier') {
          return
        }
        if (!LEGACY_ALIASES.has(node.property.name)) {
          return
        }
        // Confirm it's `process.env.X` shape so we don't false-positive
        // on unrelated objects that happen to have a property named
        // SOCKET_API_KEY.
        const obj = node.object
        if (
          obj.type !== 'MemberExpression' ||
          obj.property.type !== 'Identifier' ||
          obj.property.name !== 'env'
        ) {
          return
        }
        if (obj.object.type !== 'Identifier' || obj.object.name !== 'process') {
          return
        }
        if (hasBypassComment(node)) {
          return
        }
        context.report({
          node: node.property,
          messageId: 'legacy',
          data: { name: node.property.name },
          fix(fixer: RuleFixer) {
            return fixer.replaceText(node.property, CANONICAL)
          },
        })
      },
    }
  },
}

export default rule
