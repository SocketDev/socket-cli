/**
 * @fileoverview Patch for debug package to fix delete process.env.DEBUG.
 * Transforms `delete process.env.DEBUG` to `process.env.DEBUG = undefined`
 * to avoid "delete void 0" syntax error in strict mode after Rollup replace plugin.
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
  packageName: 'debug',
  version: '4.4.3',
  description: 'Transform delete process.env.DEBUG to assignment',

  files: ['src/node.js'],

  async transform(filePath, utils) {
    const { MagicString, parseCode, readFile, writeFile } = utils

    const code = await readFile(filePath)

    // Check if transformation is needed.
    if (!code.includes('delete process.env.DEBUG')) {
      return false
    }

    const ast = parseCode(code, { sourceType: 'module' })
    const s = new MagicString(code)

    // Find and replace: delete process.env.DEBUG -> process.env.DEBUG = undefined.
    traverseAST(ast, node => {
      if (
        node.type === 'UnaryExpression' &&
        node.operator === 'delete' &&
        node.argument?.type === 'MemberExpression' &&
        node.argument.object?.type === 'MemberExpression' &&
        node.argument.object.object?.name === 'process' &&
        node.argument.object.property?.name === 'env' &&
        node.argument.property?.name === 'DEBUG'
      ) {
        // Replace "delete process.env.DEBUG" with "process.env.DEBUG = undefined".
        s.overwrite(node.start, node.end, 'process.env.DEBUG = undefined')
      }
    })

    if (s.hasChanged()) {
      await writeFile(filePath, s.toString())
      return true
    }

    return false
  },
}
