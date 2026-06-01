/**
 * @file Per CLAUDE.md "Token hygiene → Socket API token env var" rule: The
 *   canonical fleet name is `SOCKET_API_TOKEN`. The legacy names
 *   `SOCKET_API_KEY`, `SOCKET_SECURITY_API_TOKEN`, and
 *   `SOCKET_SECURITY_API_KEY` are accepted as aliases for one cycle
 *   (deprecation grace period) — bootstrap hooks read all four and normalize to
 *   `SOCKET_API_TOKEN` going forward. Detects string literals naming any of the
 *   legacy aliases:
 *
 *   - SOCKET_API_KEY
 *   - SOCKET_SECURITY_API_TOKEN
 *   - SOCKET_SECURITY_API_KEY Autofix: rewrites to `SOCKET_API_TOKEN`. Skipped:
 *   - Lines marked with `socket-api-token-env: bootstrap` adjacent comment — the
 *     alias-normalization code that intentionally reads all four names. The
 *     bootstrap hook is the one place legacy aliases legitimately appear.
 *   - The literal `SOCKET_CLI_API_TOKEN` — unrelated; that's the socket-cli
 *     configuration setting, not an API token alias.
 */

import { isPluginSelfFile } from '../lib/fleet-paths.mts'
import type { AstNode, RuleContext, RuleFixer } from '../lib/rule-types.mts'

// This rule DEFINES the legacy-alias set; the strings here are rule data, not
// env-var consumers. The plugin-self-file guard in `create()` exempts this file
// (and the test fixtures) so the rule doesn't flag its own lookup table.
const LEGACY_ALIASES = new Set([
  'SOCKET_API_KEY',
  'SOCKET_SECURITY_API_KEY',
  'SOCKET_SECURITY_API_TOKEN',
])

const CANONICAL = 'SOCKET_API_TOKEN'

const BYPASS_RE = /socket-api-token-env:\s*bootstrap/

/**
 * @type {import('eslint').Rule.RuleModule}
 */
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
    // This rule's own source lists the legacy aliases as lookup-table data and
    // its test file exercises them as fixtures.
    if (isPluginSelfFile(context)) {
      return {}
    }

    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

    function hasBypassComment(node: AstNode) {
      // Walk up: literal -> array element -> array/declaration. The bypass
      // comment can sit on the literal itself OR on any ancestor up to (and
      // including) the nearest statement. This lets the entire alias-lookup
      // array carry one bypass instead of needing one per element.
      let cursor: AstNode | undefined = node
      while (cursor) {
        const before = sourceCode.getCommentsBefore(cursor)
        const after = sourceCode.getCommentsAfter(cursor)
        for (const c of [...before, ...after]) {
          if (BYPASS_RE.test(c.value)) {
            return true
          }
        }
        if (
          cursor.type === 'ExportNamedDeclaration' ||
          cursor.type === 'ExpressionStatement' ||
          cursor.type === 'VariableDeclaration'
        ) {
          break
        }
        cursor = cursor.parent
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

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
