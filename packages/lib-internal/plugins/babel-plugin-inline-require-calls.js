const { createRequire } = require('node:module')
const fs = require('node:fs')
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
            `${absolutePath}.ts`,
            `${absolutePath}.js`,
            `${absolutePath}/index.ts`,
            `${absolutePath}/index.js`,
          ]

          // Find the first path that exists.
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

          // Check if the source exports a primitive value that is safe to inline.
          const source = fs.readFileSync(resolvedPath, 'utf8')
          if (!isInlinablePrimitive(source, babel)) {
            throw new Error(
              'Cannot inline require: module must export a literal primitive value (string, number, boolean, null)',
            )
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
            ` was: require('${requirePath}') `,
            false,
          )

          nodePath.replaceWith(replacement)
        } catch (e) {
          throw nodePath.buildCodeFrameError(
            `Cannot inline require('${requirePath}'): ${e.message}`,
          )
        }
      },
    },
  }
}

/**
 * Check if source code exports a primitive literal value that is safe to inline.
 *
 * @param {string} source - Source code to check
 * @param {object} babel - Babel API object
 * @returns {boolean} True if the module exports only a primitive literal
 */
function isInlinablePrimitive(source, babel) {
  const { parseSync } = require('@babel/core')
  const { types: t } = babel

  try {
    // Parse the source code.
    const ast = parseSync(source, {
      filename: 'inline-check.ts',
      presets: ['@babel/preset-typescript'],
      sourceType: 'module',
    })

    if (!ast || !ast.program || !ast.program.body) {
      return false
    }

    // Find export default declaration.
    const exportDefault = ast.program.body.find(node =>
      t.isExportDefaultDeclaration(node),
    )

    if (!exportDefault) {
      return false
    }

    const declaration = exportDefault.declaration

    // Check if it's a literal primitive value or constant expression.
    // Allow: string, number, boolean, null, undefined, and constant math expressions
    // Disallow: runtime-dependent expressions, identifiers, function calls, etc.
    return isPrimitiveOrConstantExpression(declaration, t)
  } catch {
    // If parsing fails, don't inline.
    return false
  }
}

/**
 * Check if a node is a primitive literal or a constant expression.
 *
 * @param {object} node - Babel AST node
 * @param {object} t - Babel types
 * @returns {boolean} True if safe to inline
 */
function isPrimitiveOrConstantExpression(node, t) {
  // Literal primitives.
  if (
    t.isStringLiteral(node) ||
    t.isNumericLiteral(node) ||
    t.isBooleanLiteral(node) ||
    t.isNullLiteral(node) ||
    t.isIdentifier(node, { name: 'undefined' })
  ) {
    return true
  }

  // Unary expressions: -5, +5, !true, ~0x1
  if (t.isUnaryExpression(node)) {
    return isPrimitiveOrConstantExpression(node.argument, t)
  }

  // Binary expressions: 7 * 24 * 60 * 60 * 1000
  if (t.isBinaryExpression(node) || t.isLogicalExpression(node)) {
    return (
      isPrimitiveOrConstantExpression(node.left, t) &&
      isPrimitiveOrConstantExpression(node.right, t)
    )
  }

  // Template literals with no expressions: `hello`
  if (t.isTemplateLiteral(node)) {
    return (
      !node.expressions ||
      node.expressions.length === 0 ||
      node.expressions.every(expr => isPrimitiveOrConstantExpression(expr, t))
    )
  }

  // Disallow: member expressions (process.platform), call expressions, etc.
  return false
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
  throw new Error(`Unsupported value type: ${typeof value}`)
}
