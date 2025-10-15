/**
 * Rollup plugin to fix yoga-layout's top-level await issue.
 * Converts async WASM loading to synchronous using busy-wait (spinlock).
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
        // Replace with synchronous busy-wait pattern.
        ast.program.body.forEach(node => {
          if (
            node.type === 'VariableDeclaration' &&
            node.declarations[0]?.id?.name === 'Yoga' &&
            node.declarations[0]?.init?.type === 'CallExpression' &&
            node.declarations[0]?.init?.callee?.name === 'wrapAssembly' &&
            node.declarations[0]?.init?.arguments[0]?.type === 'AwaitExpression'
          ) {
            // Replace with busy-wait synchronous loading.
            const nodeStart = node.start
            const nodeEnd = node.end
            s.overwrite(
              nodeStart,
              nodeEnd,
              `const Yoga = wrapAssembly(loadYoga());`
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
        console.error('Failed to parse yoga-layout:', e)
        return null
      }

      return null
    },
  }
}
