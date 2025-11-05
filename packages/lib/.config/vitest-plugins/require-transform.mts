import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { parse } from '@babel/parser'
import type { NodePath } from '@babel/traverse'
import traverseModule from '@babel/traverse'
import * as t from '@babel/types'
import MagicString from 'magic-string'

import type { Plugin } from 'vite'

import { getDistDir, srcToDistPath } from './transform-utils.mts'

// Handle both ESM and CJS exports from @babel/traverse
const traverse =
  (traverseModule as { default?: typeof traverseModule }).default ||
  traverseModule

/**
 * Vite plugin to inline CommonJS require() calls.
 * Uses Babel AST parsing for robust detection and MagicString for source transformations.
 * Since require() bypasses Vite's module system, we inline simple constant values at transform time.
 */
export function createRequireTransformPlugin(): Plugin {
  // Cache for loaded constant values
  const constantCache = new Map<string, string | null>()

  /**
   * Evaluate if a constant file can be safely inlined.
   *
   * Strategy:
   * 1. Check cache first for performance
   * 2. Read and parse the TypeScript file into an AST
   * 3. Detect if the file has imports (makes it non-inlineable)
   * 4. Find the default export and check if it's a safe, simple expression
   * 5. Extract the source code of safe expressions for inlining
   *
   * Returns the stringified value if inlineable, null otherwise.
   *
   * @param resolvedPath - Absolute path to the constant file
   * @returns Source code string to inline, or null if not inlineable
   */
  function loadConstant(resolvedPath: string): string | null {
    // Step 1: Check cache to avoid re-parsing the same file
    if (constantCache.has(resolvedPath)) {
      const cached = constantCache.get(resolvedPath)
      return cached === undefined ? null : cached
    }

    try {
      // Step 2: Read the source file from disk
      const content = readFileSync(resolvedPath, 'utf8')

      // Step 3: Parse TypeScript source into an Abstract Syntax Tree (AST).
      // This allows us to analyze the code structure programmatically.
      // Parse as ES module (supports import/export).
      // Enable TypeScript syntax parsing.
      const ast = parse(content, {
        sourceType: 'module',
        plugins: ['typescript'],
      })

      // Step 4: Track state during AST traversal.
      // Files with imports are too complex to inline.
      let hasImports = false
      // Will hold the inlineable value.
      let defaultExportValue: string | null = null

      // Step 5: Traverse the AST to find imports and exports
      // traverse() walks through every node in the syntax tree
      traverse(ast, {
        // Visitor for import statements (e.g., import foo from './bar')
        ImportDeclaration() {
          // If the file imports other modules, it has dependencies
          // and shouldn't be inlined (too complex)
          hasImports = true
        },

        // Visitor for default exports (e.g., export default 'value')
        ExportDefaultDeclaration(
          nodePath: NodePath<t.ExportDefaultDeclaration>,
        ) {
          const declaration = nodePath.node.declaration

          // Step 6: Check if the exported value is a safe, simple expression
          // We only inline literals and simple safe expressions to avoid
          // breaking code that requires runtime evaluation

          // Inline primitive literals: strings, numbers, booleans, null, undefined.
          // 'hello' or "hello".
          // 42 or 3.14.
          // true or false.
          // null.
          // undefined.
          // [] or [1, 2, 3].
          // {} or {a: 1}.
          if (
            t.isStringLiteral(declaration) ||
            t.isNumericLiteral(declaration) ||
            t.isBooleanLiteral(declaration) ||
            t.isNullLiteral(declaration) ||
            t.isIdentifier(declaration, { name: 'undefined' }) ||
            t.isArrayExpression(declaration) ||
            t.isObjectExpression(declaration)
          ) {
            // Step 7: Extract the exact source code for this expression
            // Using start/end positions from the AST preserves formatting
            if (
              typeof declaration.start === 'number' &&
              typeof declaration.end === 'number'
            ) {
              defaultExportValue = content.slice(
                declaration.start,
                declaration.end,
              )
            }
          }
          // Inline binary expressions like: process.platform === 'win32'
          else if (t.isBinaryExpression(declaration)) {
            // Safe because it's evaluated at load time
            if (
              typeof declaration.start === 'number' &&
              typeof declaration.end === 'number'
            ) {
              defaultExportValue = content.slice(
                declaration.start,
                declaration.end,
              )
            }
          }
          // Inline Object.freeze() calls for frozen constants
          else if (t.isCallExpression(declaration)) {
            // Check if it's ObjectFreeze() or Object.freeze()
            if (
              t.isIdentifier(declaration.callee, { name: 'ObjectFreeze' }) ||
              (t.isMemberExpression(declaration.callee) &&
                t.isIdentifier(declaration.callee.object, { name: 'Object' }) &&
                t.isIdentifier(declaration.callee.property, { name: 'freeze' }))
            ) {
              if (
                typeof declaration.start === 'number' &&
                typeof declaration.end === 'number'
              ) {
                defaultExportValue = content.slice(
                  declaration.start,
                  declaration.end,
                )
              }
            }
          }
          // Inline template literals like: `hello ${world}`
          else if (t.isTemplateLiteral(declaration)) {
            // Safe if they only contain simple expressions
            if (
              typeof declaration.start === 'number' &&
              typeof declaration.end === 'number'
            ) {
              defaultExportValue = content.slice(
                declaration.start,
                declaration.end,
              )
            }
          }
        },
      })

      // Step 8: Determine if we can inline this constant
      // Don't inline if:
      // - The file has imports (depends on other modules)
      // - No safe default export was found
      // - The export is a complex expression (function call, etc.)
      if (hasImports || !defaultExportValue) {
        constantCache.set(resolvedPath, null)
        return null
      }

      // Step 9: Cache and return the inlineable value
      constantCache.set(resolvedPath, defaultExportValue)
      return defaultExportValue
    } catch {
      // Parse error (invalid syntax) or file doesn't exist.
      // Cache null to avoid retrying.
      constantCache.set(resolvedPath, null)
      return null
    }
  }

  return {
    name: 'socket:require-transform',

    /**
     * Transform source code to inline require() calls for constants.
     *
     * This is called by Vite for each source file during the build/test process.
     *
     * Strategy:
     * 1. Filter to only our lib files to avoid processing unrelated code
     * 2. Quick check if file contains require() to skip unnecessary parsing
     * 3. Parse the source into an AST for robust detection
     * 4. Find all require() CallExpression nodes
     * 5. For each require('./X.js'), try to inline the constant value
     * 6. Use MagicString to perform precise source code replacements
     * 7. Generate source map for debugging
     *
     * @param code - Source code of the file
     * @param id - Absolute path to the file being transformed
     * @returns Transformed code with inlined constants, or null if no changes
     */
    transform(code: string, id: string) {
      // Step 1: Only apply to our registry lib files during coverage
      // This prevents accidentally transforming node_modules or test files
      if (!id.includes('/registry/src/lib/')) {
        return null
      }

      // Step 2: Quick early exit optimization
      // If the file doesn't contain 'require(', skip expensive AST parsing
      if (!code.includes('require(')) {
        return null
      }

      // Step 3: Initialize MagicString for precise source code manipulation.
      // MagicString allows us to replace specific ranges while preserving
      // the rest of the source code and generating accurate source maps.
      const s = new MagicString(code)
      // Track if we made any changes.
      let modified = false

      try {
        // Step 4: Parse the source file into an AST.
        // This gives us a structured representation of the code.
        // Support ES modules (import/export).
        // Parse TypeScript syntax.
        const ast = parse(code, {
          sourceType: 'module',
          plugins: ['typescript'],
        })

        // Step 5: Traverse the AST to find all require() calls
        // traverse() visits every node in the syntax tree
        traverse(ast, {
          // Visitor for function calls (e.g., require(...), foo(), etc.)
          CallExpression(nodePath: NodePath<t.CallExpression>) {
            const { node } = nodePath

            // Step 6: Check if this call is specifically require()
            // We only want to transform require(), not other function calls.
            // Not a require() call, skip.
            if (!t.isIdentifier(node.callee, { name: 'require' })) {
              return
            }

            // Step 7: Handle both string literals and template literals
            if (node.arguments.length !== 1) {
              return
            }

            const arg = node.arguments[0]

            // Handle template literals like `require(\`./\${variable}\`)`
            if (t.isTemplateLiteral(arg)) {
              // Only handle simple patterns: `./prefix${variable}suffix`
              // Check if it starts with ./ or ../
              const firstQuasi = arg.quasis[0]
              if (
                !firstQuasi?.value.raw.startsWith('./') &&
                !firstQuasi?.value.raw.startsWith('../')
              ) {
                return
              }

              // Build a template literal that resolves to dist/
              // For constants/index.ts with require(`./\${k}`):
              // Transform to require(`/abs/path/dist/lib/constants/\${k}`)
              const distDir = getDistDir(id)

              if (!distDir) {
                return
              }

              // Reconstruct the template literal with absolute dist path
              // Replace the leading ./ or ../ with the absolute dist path
              const newQuasis = arg.quasis.map((quasi, i) => {
                if (i === 0) {
                  const raw = quasi.value.raw.replace(/^\.\.?\//, `${distDir}/`)
                  return t.templateElement({ raw, cooked: raw }, quasi.tail)
                }
                return quasi
              })

              // Replace the argument
              if (
                typeof arg.start === 'number' &&
                typeof arg.end === 'number'
              ) {
                s.overwrite(
                  arg.start,
                  arg.end,
                  code
                    .slice(arg.start, arg.end)
                    .replace(firstQuasi.value.raw, newQuasis[0].value.raw),
                )
                modified = true
              }
              return
            }

            // Handle string literals (existing logic)
            if (!t.isStringLiteral(arg)) {
              return
            }

            const requirePath = arg.value

            // Step 8: Only handle relative requires from our code.
            // We don't inline:
            // - Absolute requires (e.g., require('fs'))
            // - npm package requires (e.g., require('lodash'))
            // Not a relative require, skip.
            if (
              !requirePath.startsWith('./') &&
              !requirePath.startsWith('../')
            ) {
              return
            }

            try {
              // Step 9: Resolve the require modulePath to the actual TypeScript file.
              // Directory of current file.
              const currentDir = dirname(id)

              // Special handling for external dependencies that only exist in dist.
              // These are bundled modules that don't have TypeScript sources.
              const externalModules = [
                'fast-sort',
                'semver',
                'del',
                'cacache',
                'libnpmpack',
                'pacote',
                'browserslist',
                'yargs-parser',
                'zod',
              ]

              // Check if this is an external module require.
              const requireName = requirePath
                .replace(/^\.\.\/\.\.\//, '')
                .replace(/\.js$/, '')
              if (externalModules.includes(requireName)) {
                // For external modules, directly use the dist version.
                const projectRoot = id.split('/registry/')[0]
                const distPath = resolve(
                  projectRoot,
                  'registry/dist',
                  `${requireName}.js`,
                )

                // Replace the require with absolute path to dist.
                const stringNode = arg as t.StringLiteral
                if (
                  typeof stringNode.start === 'number' &&
                  typeof stringNode.end === 'number'
                ) {
                  s.overwrite(stringNode.start, stringNode.end, `'${distPath}'`)
                  modified = true
                }
                return
              }

              // Convert .js to .ts, or add .ts if no extension.
              const tsPath = requirePath.endsWith('.js')
                ? requirePath.replace(/\.js$/, '.ts')
                : `${requirePath}.ts`
              // Absolute file path.
              const resolvedPath = resolve(currentDir, tsPath)

              // Step 10: Try to load and inline the constant.
              const value = loadConstant(resolvedPath)
              if (value !== null) {
                // Step 11: Determine what to replace.
                // Handle both require('./X.js') and require('./X.js').default.
                const parent = nodePath.parent
                // Start of require() call.
                const replaceStart = node.start
                // End of require() call.
                let replaceEnd = node.end

                if (
                  typeof replaceStart !== 'number' ||
                  typeof replaceEnd !== 'number'
                ) {
                  return
                }

                // Check if there's a .default property access after require().
                // Is a property access.
                // On the require() result.
                // Accessing .default.
                if (
                  t.isMemberExpression(parent) &&
                  parent.object === node &&
                  t.isIdentifier(parent.property, { name: 'default' })
                ) {
                  // Replace the entire require('./X.js').default expression
                  if (typeof parent.end === 'number') {
                    replaceEnd = parent.end
                  }
                }

                // Step 12: Use MagicString to replace the require with the inlined value
                // This preserves the rest of the source code exactly as-is.
                s.overwrite(replaceStart, replaceEnd, value)
                modified = true
              } else {
                // Step 11b: If we can't inline, rewrite to use compiled dist/ version.
                // During coverage, require() can't load TypeScript files, so we use
                // the compiled JavaScript files from dist/ which Node can handle.
                const stringNode = arg as t.StringLiteral
                const absoluteDistPath = srcToDistPath(resolvedPath)

                if (!absoluteDistPath) {
                  // Not in lib directory, skip transformation.
                  return
                }

                // Replace the require string with the absolute dist path.
                if (
                  typeof stringNode.start === 'number' &&
                  typeof stringNode.end === 'number'
                ) {
                  s.overwrite(
                    stringNode.start,
                    stringNode.end,
                    `'${absoluteDistPath}'`,
                  )
                  modified = true
                }
              }
            } catch {
              // Resolution error (file doesn't exist, etc.).
              // Skip this require() and leave it as-is.
            }
          },
        })
      } catch {
        // Parse error (invalid TypeScript syntax).
        // Return null to use original code without transformation.
        return null
      }

      // Step 13: Return transformed code if we made any changes.
      if (modified) {
        // Get the transformed source code.
        // Generate source map for debugging.
        return {
          code: s.toString(),
          map: s.generateMap({ hires: true }),
        }
      }

      // No changes made, return null to use original code.
      return null
    },
  }
}
