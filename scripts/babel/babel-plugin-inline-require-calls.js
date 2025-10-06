/**
 * @fileoverview Babel plugin to inline require calls marked with @__INLINE__.
 */

'use strict'

const { createRequire } = require('node:module')
const path = require('node:path')

/**
 * Babel plugin to inline require calls.
 *
 * @param {object} babel - Babel API object
 * @returns {object} Babel plugin object
 */
module.exports = function inlineRequireCalls(babel) {
  const { types: t } = babel

  return {
    name: 'inline-require-calls',

    visitor: {
      CallExpression(nodePath, state) {
        const { node } = nodePath

        // Check if this is a require() call.
        if (
          !t.isIdentifier(node.callee, { name: 'require' }) ||
          node.arguments.length !== 1
        ) {
          return
        }

        // Check if the first argument is a string literal.
        const arg = node.arguments[0]
        if (!t.isStringLiteral(arg)) {
          return
        }

        // Check for /*@__INLINE__*/ comment in leading comments.
        const leadingComments = node.leadingComments || []
        const hasInlineDirective = leadingComments.some(comment => {
          return (
            comment.type === 'CommentBlock' &&
            comment.value.trim() === '@__INLINE__'
          )
        })

        if (!hasInlineDirective) {
          return
        }

        // Resolve the require path relative to the current file.
        const currentFilePath = state.filename || state.file.opts.filename
        if (!currentFilePath) {
          throw nodePath.buildCodeFrameError(
            'Cannot inline require: unable to determine current file path',
          )
        }

        const requirePath = arg.value
        const currentDir = path.dirname(currentFilePath)
        let absolutePath

        try {
          // Resolve the path relative to the current file.
          // Try both with and without .ts extension for TypeScript files.
          absolutePath = path.resolve(currentDir, requirePath)
          const possiblePaths = [
            absolutePath,
            absolutePath + '.ts',
            absolutePath + '.js',
            absolutePath + '/index.ts',
            absolutePath + '/index.js',
          ]

          // Find the first path that exists.
          const fs = require('node:fs')
          let resolvedPath = absolutePath
          for (const testPath of possiblePaths) {
            try {
              if (fs.existsSync(testPath)) {
                resolvedPath = testPath
                break
              }
            } catch {
              // Ignore errors, continue checking.
            }
          }

          // Create a require function relative to the current file.
          const requireFunc = createRequire(currentFilePath)

          // Load the module.
          const module = requireFunc(resolvedPath)

          // Get the default export (supports both ESM default and CJS module.exports).
          const value = module.default ?? module

          // Verify the value is serializable (primitive or simple object).
          if (!isSerializable(value)) {
            throw new Error(
              'Cannot inline require: value is not serializable (got ' +
                typeof value +
                ')',
            )
          }

          // Replace the require call with the actual value.
          const replacement = valueToASTNode(t, value)

          // Add a comment to indicate what was inlined.
          t.addComment(
            replacement,
            'trailing',
            " was: require('" + requirePath + "') ",
            false,
          )

          nodePath.replaceWith(replacement)
        } catch (e) {
          throw nodePath.buildCodeFrameError(
            "Cannot inline require('" + requirePath + "'): " + e.message,
          )
        }
      },
    },
  }
}

/**
 * Check if a value can be serialized to an AST node.
 */
function isSerializable(value) {
  const type = typeof value
  return (
    value === null ||
    value === undefined ||
    type === 'string' ||
    type === 'number' ||
    type === 'boolean'
  )
}

/**
 * Convert a JavaScript value to a Babel AST node.
 */
function valueToASTNode(t, value) {
  if (value === null) {
    return t.nullLiteral()
  }
  if (value === undefined) {
    return t.identifier('undefined')
  }
  if (typeof value === 'string') {
    return t.stringLiteral(value)
  }
  if (typeof value === 'number') {
    return t.numericLiteral(value)
  }
  if (typeof value === 'boolean') {
    return t.booleanLiteral(value)
  }
  throw new Error('Unsupported value type: ' + typeof value)
}
