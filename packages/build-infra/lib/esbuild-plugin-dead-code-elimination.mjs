/**
 * @fileoverview esbuild plugin for dead code elimination.
 *
 * Removes unreachable code branches like `if (false) { ... }` and `if (true) { } else { ... }`.
 * Uses Babel parser + magic-string for safe AST-based transformations.
 *
 * @example
 * import { deadCodeEliminationPlugin } from 'build-infra/lib/esbuild-plugin-dead-code-elimination'
 *
 * export default {
 *   plugins: [deadCodeEliminationPlugin()],
 * }
 */

import { parse } from '@babel/parser'
import traverseDefault from '@babel/traverse'
import MagicString from 'magic-string'

// Handle default export from @babel/traverse.
const traverse = traverseDefault.default || traverseDefault

/**
 * Evaluate a test expression to determine if it's a constant boolean.
 *
 * @param {import('@babel/types').Node} test - Test expression node
 * @returns {boolean | null} true/false if constant, null if dynamic
 */
function evaluateTest(test) {
  if (test.type === 'BooleanLiteral') {
    return test.value
  }
  if (test.type === 'UnaryExpression' && test.operator === '!') {
    const argValue = evaluateTest(test.argument)
    return argValue !== null ? !argValue : null
  }
  return null
}

/**
 * Remove dead code branches from JavaScript code.
 *
 * @param {string} code - JavaScript code to transform
 * @returns {string} Transformed code with dead branches removed
 */
function removeDeadCode(code) {
  const ast = parse(code, {
    sourceType: 'module',
    plugins: [],
  })

  const s = new MagicString(code)
  const nodesToRemove = []

  traverse(ast, {
    IfStatement(path) {
      const testValue = evaluateTest(path.node.test)

      if (testValue === false) {
        // if (false) { ... } [else { ... }]
        // Remove entire if statement, keep else block if present.
        if (path.node.alternate) {
          // Replace if statement with else block content.
          const { alternate } = path.node
          if (alternate.type === 'BlockStatement') {
            // Remove braces from else block.
            const start = alternate.start + 1
            const end = alternate.end - 1
            const elseContent = code.slice(start, end).trim()
            nodesToRemove.push({
              start: path.node.start,
              end: path.node.end,
              replacement: elseContent,
            })
          } else {
            // Single statement else.
            nodesToRemove.push({
              start: path.node.start,
              end: path.node.end,
              replacement: code.slice(alternate.start, alternate.end),
            })
          }
        } else {
          // No else block, remove entire if statement.
          nodesToRemove.push({
            start: path.node.start,
            end: path.node.end,
            replacement: '',
          })
        }
      } else if (testValue === true) {
        // if (true) { ... } [else { ... }]
        // Keep consequent, remove else block.
        const { consequent } = path.node
        if (consequent.type === 'BlockStatement') {
          // Remove braces from consequent block.
          const start = consequent.start + 1
          const end = consequent.end - 1
          const consequentContent = code.slice(start, end).trim()
          nodesToRemove.push({
            start: path.node.start,
            end: path.node.end,
            replacement: consequentContent,
          })
        } else {
          // Single statement consequent.
          nodesToRemove.push({
            start: path.node.start,
            end: path.node.end,
            replacement: code.slice(consequent.start, consequent.end),
          })
        }
      }
    },
  })

  // Apply replacements in reverse order to maintain correct positions.
  for (const node of nodesToRemove.reverse()) {
    s.overwrite(node.start, node.end, node.replacement)
  }

  return s.toString()
}

/**
 * Create esbuild plugin for dead code elimination.
 *
 * @returns {import('esbuild').Plugin} esbuild plugin
 */
export function deadCodeEliminationPlugin() {
  return {
    name: 'dead-code-elimination',
    setup(build) {
      build.onEnd((result) => {
        const outputs = result.outputFiles
        if (!outputs || outputs.length === 0) {
          return
        }

        for (const output of outputs) {
          // Only process JavaScript files.
          if (!output.path.endsWith('.js')) {
            continue
          }

          let content = output.text

          // Remove dead code branches.
          content = removeDeadCode(content)

          // Update the output content.
          output.contents = Buffer.from(content, 'utf8')
        }
      })
    },
  }
}
