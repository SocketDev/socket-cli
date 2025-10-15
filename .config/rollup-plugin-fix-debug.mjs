/**
 * Rollup plugin to fix debug package's delete process.env issue.
 * Uses Babel AST to transform delete statements before bundling.
 */

import { parse } from '@babel/core'
import MagicString from 'magic-string'

export default function fixDebug() {
  return {
    name: 'fix-debug',

    transform(code, id) {
      // Only process debug package's node.js file.
      if (!id.includes('debug') || !id.includes('node.js')) {
        return null
      }

      // Only patch if file has delete process.env.DEBUG (not already patched).
      if (!code.includes('delete process.env.DEBUG')) {
        return null
      }

      try {
        const ast = parse(code, {
          sourceType: 'module',
          plugins: [],
        })

        const s = new MagicString(code)

        // Find and replace: delete process.env.DEBUG
        // We need to traverse the AST to find UnaryExpression with delete operator.
        function traverse(node) {
          if (!node || typeof node !== 'object') {
            return
          }

          if (
            node.type === 'UnaryExpression' &&
            node.operator === 'delete' &&
            node.argument?.type === 'MemberExpression' &&
            node.argument.object?.type === 'MemberExpression' &&
            node.argument.object.object?.name === 'process' &&
            node.argument.object.property?.name === 'env' &&
            node.argument.property?.name === 'DEBUG'
          ) {
            // Replace "delete process.env.DEBUG" with "process.env.DEBUG = undefined".
            s.overwrite(node.start, node.end, 'process.env.DEBUG = undefined')
          }

          // Recursively traverse all properties.
          for (const key in node) {
            if (key === 'start' || key === 'end' || key === 'loc') {
              continue
            }
            const value = node[key]
            if (Array.isArray(value)) {
              value.forEach(traverse)
            } else if (value && typeof value === 'object') {
              traverse(value)
            }
          }
        }

        traverse(ast)

        if (s.hasChanged()) {
          return {
            code: s.toString(),
            map: s.generateMap({ hires: true }),
          }
        }
      } catch (e) {
        // If parsing fails, log error and return null.
        console.error('Failed to parse debug package:', e)
        return null
      }

      return null
    },
  }
}
