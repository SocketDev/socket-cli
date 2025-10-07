/**
 * Rollup plugin to strip top-level await from Ink's reconciler.
 * Ink's reconciler has a conditional top-level await for dev tools which doesn't work in CJS.
 * We remove the entire DEV mode block since it's only for development debugging.
 *
 * Uses Babel + magic-string for reliable AST-based transformation.
 */

import { readFileSync } from 'node:fs'

import { parseSync } from '@babel/core'
import MagicString from 'magic-string'

/**
 * Check if a node is a MemberExpression for process.env['DEV'] or process.env.DEV
 */
function isProcessEnvDev(node) {
  if (node.type !== 'MemberExpression') {
    return false
  }

  const { object, property } = node

  // Check if it's process.env
  if (
    object.type !== 'MemberExpression' ||
    object.object.type !== 'Identifier' ||
    object.object.name !== 'process' ||
    object.property.type !== 'Identifier' ||
    object.property.name !== 'env'
  ) {
    return false
  }

  // Check if property is 'DEV'
  if (property.type === 'Identifier' && property.name === 'DEV') {
    return true
  }
  if (property.type === 'StringLiteral' && property.value === 'DEV') {
    return true
  }

  return false
}

/**
 * Check if a node contains an await import() call
 */
function containsAwaitImport(node) {
  if (!node) {
    return false
  }

  if (
    node.type === 'AwaitExpression' &&
    node.argument?.type === 'CallExpression'
  ) {
    const { callee } = node.argument
    if (callee.type === 'Import') {
      return true
    }
  }

  // Recursively check child nodes
  for (const key in node) {
    if (key === 'loc' || key === 'start' || key === 'end') {
      continue
    }
    const value = node[key]

    if (Array.isArray(value)) {
      for (const item of value) {
        if (
          typeof item === 'object' &&
          item !== null &&
          containsAwaitImport(item)
        ) {
          return true
        }
      }
    } else if (typeof value === 'object' && value !== null) {
      if (containsAwaitImport(value)) {
        return true
      }
    }
  }

  return false
}

/**
 * Find and remove the if statement that checks process.env['DEV'] === 'true'
 * and contains an await import() call
 */
function removeDevToolsBlock(code) {
  const ast = parseSync(code, {
    sourceType: 'module',
    parserOpts: {
      ranges: true,
    },
  })

  const s = new MagicString(code)

  // Traverse top-level statements
  for (const node of ast.program.body) {
    if (
      node.type === 'IfStatement' &&
      node.test.type === 'BinaryExpression' &&
      node.test.operator === '===' &&
      isProcessEnvDev(node.test.left) &&
      node.test.right.type === 'StringLiteral' &&
      node.test.right.value === 'true' &&
      containsAwaitImport(node.consequent)
    ) {
      // Found the if block - remove it
      const start = node.start
      const end = node.end

      s.overwrite(
        start,
        end,
        '// DEV mode devtools import removed (top-level await not supported in CJS)',
      )

      break
    }
  }

  return s.toString()
}

export default function transformInkPlugin() {
  return {
    name: 'transform-ink',

    load(id) {
      // Only target ink's reconciler file
      if (!id.includes('ink/build/reconciler.js')) {
        return null
      }

      // Read and transform the file using AST-based transformation
      const code = readFileSync(id, 'utf8')
      const transformedCode = removeDevToolsBlock(code)

      return {
        code: transformedCode,
        map: null,
      }
    },
  }
}
