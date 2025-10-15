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
              `const __yogaModule = loadYoga();
if (__yogaModule && typeof __yogaModule === 'object' && '__modules' in __yogaModule) {
  // Module is already initialized (synchronous case).
  var Yoga = wrapAssembly(__yogaModule);
} else {
  // Module needs async initialization - poll for ready state.
  var Yoga;
  var __resolved = false;
  if (__yogaModule && __yogaModule.ready) {
    __yogaModule.ready.then(function(m) { __resolved = true; Yoga = wrapAssembly(m); });
  }
  // Synchronous wait using deasync-style polling.
  var __start = Date.now();
  while (!__resolved && Date.now() - __start < 5000) {
    // Poll - this will never actually wait in practice for embedded WASM.
  }
  if (!__resolved) throw new Error('Yoga WASM initialization timeout');
}`
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
