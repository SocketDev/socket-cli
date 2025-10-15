/**
 * @fileoverview Patch for yoga-layout package to remove top-level await.
 * Removes the await keyword from `const Yoga = wrapAssembly(await loadYoga())`
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
  packageName: 'yoga-layout',
  version: '3.2.1',
  description: 'Remove top-level await from Yoga initialization',

  files: ['dist/index.js'],

  async transform(filePath, utils) {
    const { MagicString, parseCode, readFile, writeFile } = utils

    const code = await readFile(filePath)

    // Check if transformation is needed.
    if (!code.includes('await loadYoga')) {
      return false
    }

    const ast = parseCode(code, { sourceType: 'module' })
    const s = new MagicString(code)

    // Find: const Yoga = wrapAssembly(await loadYoga());
    // Remove the await keyword.
    traverseAST(ast, node => {
      if (
        node.type === 'VariableDeclaration' &&
        node.declarations[0]?.id?.name === 'Yoga' &&
        node.declarations[0]?.init?.type === 'CallExpression' &&
        node.declarations[0]?.init?.callee?.name === 'wrapAssembly' &&
        node.declarations[0]?.init?.arguments[0]?.type === 'AwaitExpression'
      ) {
        const awaitExpr = node.declarations[0].init.arguments[0]
        // Remove "await " (including space).
        s.overwrite(awaitExpr.start, awaitExpr.argument.start, '')
      }
    })

    if (s.hasChanged()) {
      await writeFile(filePath, s.toString())
      return true
    }

    return false
  },
}
