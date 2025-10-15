/**
 * Rollup plugin to fix strict mode incompatibilities.
 *
 * This plugin fixes issues where code becomes invalid in strict mode:
 * - `delete process.env.*` statements that get transformed to `delete undefined`
 * - Top-level await in modules that need to be CommonJS
 */

import MagicString from 'magic-string'

export default function fixStrictMode() {
  return {
    name: 'fix-strict-mode',

    transform(code, id) {
      // Fix debug package: delete process.env.DEBUG
      // After replace plugin runs, this becomes "delete void 0" which is invalid.
      // We need to fix this before the replace plugin runs by wrapping it.
      if (id.includes('debug') && id.includes('node.js')) {
        const s = new MagicString(code)

        // Replace "delete process.env.DEBUG" with a try-catch that won't break.
        const deletePattern = /delete\s+process\.env\.DEBUG;?/g
        let match
        while ((match = deletePattern.exec(code))) {
          s.overwrite(
            match.index,
            match.index + match[0].length,
            'try { delete process.env.DEBUG; } catch (e) {}',
          )
        }

        if (s.hasChanged()) {
          return {
            code: s.toString(),
            map: s.generateMap({ hires: true }),
          }
        }
      }

      // Fix yoga-layout: remove top-level await.
      if (id.includes('yoga-layout') && id.includes('index.js')) {
        const s = new MagicString(code)

        // Replace "await loadYoga()" with "loadYoga()".
        // The wrapAssembly function can handle both sync and async.
        const awaitPattern =
          /const\s+Yoga\s+=\s+wrapAssembly\(await\s+loadYoga\(\)\);?/g
        let match
        while ((match = awaitPattern.exec(code))) {
          s.overwrite(
            match.index,
            match.index + match[0].length,
            'const Yoga = wrapAssembly(loadYoga());',
          )
        }

        if (s.hasChanged()) {
          return {
            code: s.toString(),
            map: s.generateMap({ hires: true }),
          }
        }
      }

      // Fix Ink: remove top-level await from devtools import.
      if (id.includes('ink') && id.includes('reconciler.js')) {
        // Only patch if file has await import (not already patched).
        if (!code.includes('await import')) {
          return null
        }

        const s = new MagicString(code)

        // Find the entire if block with try-catch containing await import.
        // Need to match: if (...) { try { await import(...); } catch (...) { ... } }
        const awaitImportPattern =
          /if\s*\(process\.env\['DEV'\]\s*===\s*'true'\)\s*\{[\s\S]*?try\s*\{[\s\S]*?await\s+import\(['"]\.\/devtools\.js['"]\);[\s\S]*?\}\s*catch[\s\S]*?\{[\s\S]*?\}[\s\S]*?\}/g
        let match
        while ((match = awaitImportPattern.exec(code))) {
          // Replace with no-op function.
          s.overwrite(
            match.index,
            match.index + match[0].length,
            '\n// Devtools disabled - no-op function to avoid top-level await.\nfunction loadDevtools() {}\n',
          )
        }

        if (s.hasChanged()) {
          return {
            code: s.toString(),
            map: s.generateMap({ hires: true }),
          }
        }
      }

      return null
    },
  }
}
