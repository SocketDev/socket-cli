/**
 * Rollup plugin to fix Ink's top-level await issue.
 * Uses Babel AST to properly remove the await import block.
 */

import { parse } from '@babel/core'
import MagicString from 'magic-string'

export default function fixInk() {
  return {
    name: 'fix-ink',

    transform(code, id) {
      // Only process Ink's reconciler.js file.
      if (!id.includes('ink') || !id.includes('reconciler.js')) {
        return null
      }

      // Only patch if file has await import (not already patched).
      if (!code.includes('await import')) {
        return null
      }

      try {
        const ast = parse(code, {
          sourceType: 'module',
          plugins: [],
        })

        const s = new MagicString(code)

        // Find the if statement with await import inside.
        ast.program.body.forEach(node => {
          if (
            node.type === 'IfStatement' &&
            node.test.type === 'BinaryExpression' &&
            node.test.operator === '===' &&
            node.test.left.type === 'MemberExpression' &&
            node.test.left.object.type === 'MemberExpression' &&
            node.test.left.object.object.name === 'process' &&
            node.test.left.object.property.name === 'env' &&
            node.test.right.value === 'true'
          ) {
            // This is the "if (process.env['DEV'] === 'true')" block.
            // Replace the entire if statement with a no-op function.
            s.overwrite(
              node.start,
              node.end,
              '\n// Devtools disabled - no-op function to avoid top-level await.\n// Original devtools connection removed to prevent bundling issues.\n// See https://github.com/vadimdemedes/ink/issues/384\nfunction loadDevtools() {\n    // No-op: devtools intentionally disabled for bundled builds.\n}\n',
            )
          }
        })

        if (s.hasChanged()) {
          return {
            code: s.toString(),
            map: s.generateMap({ hires: true }),
          }
        }
      } catch (e) {
        // If parsing fails, just return null.
        console.error('Failed to parse Ink reconciler:', e)
        return null
      }

      return null
    },
  }
}
