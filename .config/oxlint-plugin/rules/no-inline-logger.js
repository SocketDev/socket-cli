/**
 * @fileoverview Ban inline `getDefaultLogger().<method>(...)`. The
 * logger must be hoisted at the top of the file:
 *   const logger = getDefaultLogger()
 *   ...
 *   logger.success('...')
 *
 * Inline `getDefaultLogger().success(...)` re-resolves the logger on
 * every call and reads inconsistently. The hoisted form is the
 * fleet-canonical pattern.
 *
 * No autofix: the right hoist position depends on the file's import
 * block layout, which can't be safely inferred at the call site.
 * Reporting only.
 */

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Hoist getDefaultLogger() to a const at the top of the file; do not call it inline.',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      inline:
        'getDefaultLogger() must be hoisted: add `const logger = getDefaultLogger()` near the top of the file and use `logger.{{method}}(...)`.',
    },
    schema: [],
  },

  create(context) {
    return {
      MemberExpression(node) {
        // Match: getDefaultLogger().<method>
        if (node.property.type !== 'Identifier') {
          return
        }
        const obj = node.object
        if (
          obj.type !== 'CallExpression' ||
          obj.callee.type !== 'Identifier' ||
          obj.callee.name !== 'getDefaultLogger' ||
          obj.arguments.length !== 0
        ) {
          return
        }

        context.report({
          node,
          messageId: 'inline',
          data: { method: node.property.name },
        })
      },
    }
  },
}

export default rule
