/**
 * @fileoverview Babel plugin to strip debug code blocks.
 * Removes code wrapped in DEBUG checks: if (DEBUG) { ... }
 */

/**
 * Babel plugin to strip debug code.
 *
 * Removes:
 * - if (DEBUG) { ... }
 * - if (DEBUG && condition) { ... }
 * - DEBUG && expression
 * - DEBUG ? trueExpr : falseExpr (keeps falseExpr)
 *
 * Usage in code:
 *   if (DEBUG) {
 *     console.log('debug info')
 *   }
 *   // In production build: entire block removed
 *
 * @param {object} babel - Babel API object
 * @param {object} options - Plugin options
 * @param {string[]} [options.identifiers=['DEBUG']] - Debug identifiers to strip
 * @returns {object} Babel plugin object
 */
export default function stripDebug(babel, options = {}) {
  const { types: t } = babel
  const { identifiers = ['DEBUG'] } = options
  const debugIds = new Set(identifiers)

  return {
    name: 'strip-debug',

    visitor: {
      // Remove: if (DEBUG) { ... }
      IfStatement(path) {
        const { test } = path.node

        // Check if test is DEBUG identifier or logical expression containing DEBUG.
        if (isDebugTest(t, test, debugIds)) {
          path.remove()
          return
        }

        // Handle: if (DEBUG && condition) { ... }
        if (
          t.isLogicalExpression(test, { operator: '&&' }) &&
          isDebugIdentifier(t, test.left, debugIds)
        ) {
          path.remove()
          return
        }
      },

      // Remove: DEBUG && expression
      LogicalExpression(path) {
        const { left, operator } = path.node

        if (operator === '&&' && isDebugIdentifier(t, left, debugIds)) {
          // Remove entire expression.
          if (path.parentPath.isExpressionStatement()) {
            path.parentPath.remove()
          } else {
            // Replace with undefined in other contexts.
            path.replaceWith(t.identifier('undefined'))
          }
        }
      },

      // Handle: DEBUG ? trueExpr : falseExpr → falseExpr
      ConditionalExpression(path) {
        const { alternate, test } = path.node

        if (isDebugIdentifier(t, test, debugIds)) {
          // Replace with alternate (false branch).
          path.replaceWith(alternate)
        }
      },
    },
  }
}

/**
 * Check if a node is a DEBUG identifier.
 */
function isDebugIdentifier(t, node, debugIds) {
  return t.isIdentifier(node) && debugIds.has(node.name)
}

/**
 * Check if test expression is a debug check.
 */
function isDebugTest(t, test, debugIds) {
  // Simple: if (DEBUG)
  if (isDebugIdentifier(t, test, debugIds)) {
    return true
  }

  // Logical: if (DEBUG && x) or if (x && DEBUG)
  if (t.isLogicalExpression(test, { operator: '&&' })) {
    return (
      isDebugIdentifier(t, test.left, debugIds) ||
      isDebugIdentifier(t, test.right, debugIds)
    )
  }

  return false
}
