/**
 * @fileoverview Patch for ink package to remove top-level await.
 * Replaces the entire devtools connection block with a no-op function
 * to avoid "Module format 'cjs' does not support top-level await" error.
 */

/**
 * Traverse AST recursively and apply visitor function.
 *
 * @param {object} node - AST node to traverse.
 * @param {Function} visitor - Visitor function called for each node.
 */
function traverseAST(node, visitor) {
  if (!node || typeof node !== 'object') {
    return
  }

  visitor(node)

  // Recursively traverse all properties.
  for (const key in node) {
    if (key === 'start' || key === 'end' || key === 'loc') {
      continue
    }
    const value = node[key]
    if (Array.isArray(value)) {
      value.forEach(child => traverseAST(child, visitor))
    } else if (value && typeof value === 'object') {
      traverseAST(value, visitor)
    }
  }
}

export default {
  packageName: 'ink',
  version: '6.3.1',
  description: 'Remove top-level await from devtools connection',

  files: ['dist/reconciler.js'],

  async transform(filePath, utils) {
    const { MagicString, parseCode, readFile, writeFile } = utils

    const code = await readFile(filePath)

    // Check if transformation is needed.
    if (!code.includes('await import')) {
      return false
    }

    const ast = parseCode(code, { sourceType: 'module' })
    const s = new MagicString(code)

    // Find the if statement that contains await import for devtools.
    // Look for: if (process.env.REACT_DEVTOOLS === 'true') { ... await import(...) ... }
    traverseAST(ast, node => {
      if (
        node.type === 'IfStatement' &&
        node.test?.type === 'BinaryExpression' &&
        node.test?.operator === '===' &&
        node.test?.right?.value === 'true'
      ) {
        // Check if this if statement contains an await import.
        let hasAwaitImport = false
        traverseAST(node.consequent, childNode => {
          if (
            childNode.type === 'AwaitExpression' &&
            childNode.argument?.type === 'CallExpression' &&
            childNode.argument?.callee?.type === 'Import'
          ) {
            hasAwaitImport = true
          }
        })

        if (hasAwaitImport) {
          // Replace entire if block with no-op function comment.
          const replacement = `
// Devtools disabled - no-op function to avoid top-level await.
// Original devtools connection removed to prevent bundling issues.
// See https://github.com/vadimdemedes/ink/issues/384
function loadDevtools() {
  // No-op: devtools intentionally disabled for bundled builds.
}
`
          s.overwrite(node.start, node.end, replacement)
        }
      }
    })

    if (s.hasChanged()) {
      await writeFile(filePath, s.toString())
      return true
    }

    return false
  },
}
