/**
 * Rollup plugin to fix yoga-layout's top-level await issue.
 * Uses Babel AST to properly remove the await keyword.
 */

import { parse } from '@babel/core'
import MagicString from 'magic-string'

export default function fixYoga() {
  return {
    name: 'fix-yoga',

    transform(code, id) {
      // Only process yoga-layout's index.js file.
      if (!id.includes('yoga-layout') || !id.includes('index.js')) {
        return null
      }

      // Only patch if file has await (not already patched).
      if (!code.includes('await loadYoga')) {
        return null
      }

      try {
        const ast = parse(code, {
          sourceType: 'module',
          plugins: [],
        })

        const s = new MagicString(code)

        // Find: const Yoga = wrapAssembly(await loadYoga());
        ast.program.body.forEach(node => {
          if (
            node.type === 'VariableDeclaration' &&
            node.declarations[0]?.id?.name === 'Yoga' &&
            node.declarations[0]?.init?.type === 'CallExpression' &&
            node.declarations[0]?.init?.callee?.name === 'wrapAssembly' &&
            node.declarations[0]?.init?.arguments[0]?.type === 'AwaitExpression'
          ) {
            // Found it! Remove the await keyword.
            const awaitExpr = node.declarations[0].init.arguments[0]
            s.overwrite(awaitExpr.start, awaitExpr.argument.start, '')
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
        console.error('Failed to parse yoga-layout:', e)
        return null
      }

      return null
    },
  }
}
