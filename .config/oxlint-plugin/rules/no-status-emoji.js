/**
 * @fileoverview Ban status-symbol emoji literals (✓ ✔ ❌ ✗ ⚠ ⚠️ ❗ ✅
 * ❎ ☑) inside string literals. The `@socketsecurity/lib/logger`
 * package owns the visual prefix via `logger.success()` /
 * `logger.fail()` / `logger.warn()` etc. Hand-rolling the symbols
 * fragments the visual style and bypasses theme-aware color.
 *
 * Autofix: when the literal is the FIRST argument to `console.log` /
 * `console.error` / `logger.log` (no semantic logger method specified)
 * AND only one symbol leads the string, rewrite to the matching
 * `logger.<method>(...)`. Otherwise emit a warning without a fix
 * (the human picks the right method).
 */

const EMOJI_TO_METHOD = {
  '✓': 'success',
  '✔': 'success',
  '✅': 'success',
  '❌': 'fail',
  '✗': 'fail',
  '❎': 'fail',
  '⚠': 'warn',
  '⚠️': 'warn',
  '❗': 'warn',
  '☑': 'success',
}

const EMOJI = Object.keys(EMOJI_TO_METHOD)

const EMOJI_LEAD_RE = new RegExp(
  `^\\s*(${EMOJI.map(e => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*`,
)

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Ban status-symbol emoji literals; use the logger.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      banned:
        'Status-symbol emoji "{{emoji}}" — use logger.{{method}}() from @socketsecurity/lib/logger.',
      bannedAmbiguous:
        'Status-symbol emoji "{{emoji}}" — use a logger method (success/fail/warn/info) instead of an inline symbol.',
    },
    schema: [],
  },

  create(context) {
    /**
     * Find any banned emoji in a string. Returns the first match.
     */
    function findEmoji(value) {
      for (const emoji of EMOJI) {
        if (value.includes(emoji)) {
          return emoji
        }
      }
      return null
    }

    /**
     * If the string `value` LEADS with a known emoji + whitespace,
     * return { emoji, restAfter } where restAfter is the string with
     * the leading emoji+spaces stripped. Otherwise null.
     */
    function leadingEmoji(value) {
      const match = EMOJI_LEAD_RE.exec(value)
      if (!match) {
        return null
      }
      return {
        emoji: match[1],
        restAfter: value.slice(match[0].length),
      }
    }

    /**
     * Try to autofix by rewriting `console.log('✓ Done')` →
     * `logger.success('Done')`. Returns a fixer function or null.
     */
    function tryFix(node, literalNode, leadInfo) {
      const method = EMOJI_TO_METHOD[leadInfo.emoji]
      if (!method) {
        return null
      }

      // Only fix when the parent is a CallExpression and the literal
      // is the first argument. Otherwise leave to the human.
      const parent = node.parent
      if (!parent || parent.type !== 'CallExpression') {
        return null
      }
      if (parent.arguments[0] !== literalNode) {
        return null
      }

      const callee = parent.callee
      if (callee.type !== 'MemberExpression') {
        return null
      }

      const objectName =
        callee.object.type === 'Identifier' ? callee.object.name : null
      const propName =
        callee.property.type === 'Identifier' ? callee.property.name : null
      if (!objectName || !propName) {
        return null
      }

      const isConsole =
        objectName === 'console' &&
        ['log', 'error', 'warn', 'info'].includes(propName)
      const isLoggerLog =
        objectName === 'logger' && (propName === 'log' || propName === 'info')

      if (!isConsole && !isLoggerLog) {
        return null
      }

      // Build the replacement.
      const quote = literalNode.raw[0]
      const newLiteral = `${quote}${leadInfo.restAfter.replace(new RegExp(quote, 'g'), '\\' + quote)}${quote}`

      return fixer => [
        fixer.replaceText(callee, `logger.${method}`),
        fixer.replaceText(literalNode, newLiteral),
      ]
    }

    function reportLiteral(node) {
      const value = typeof node.value === 'string' ? node.value : null
      if (!value) {
        return
      }

      const emoji = findEmoji(value)
      if (!emoji) {
        return
      }

      const leadInfo = leadingEmoji(value)
      const method = leadInfo ? EMOJI_TO_METHOD[leadInfo.emoji] : null

      if (leadInfo && method) {
        const fix = tryFix(node, node, leadInfo)
        context.report({
          node,
          messageId: 'banned',
          data: { emoji: leadInfo.emoji, method },
          ...(fix ? { fix } : {}),
        })
      } else {
        context.report({
          node,
          messageId: 'bannedAmbiguous',
          data: { emoji },
        })
      }
    }

    return {
      Literal(node) {
        reportLiteral(node)
      },
      TemplateElement(node) {
        if (node.value && typeof node.value.cooked === 'string') {
          // Treat template-string segments like literals for detection only.
          reportLiteral({ ...node, value: node.value.cooked })
        }
      },
    }
  },
}

export default rule
