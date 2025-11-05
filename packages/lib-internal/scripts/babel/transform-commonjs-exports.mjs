/**
 * @fileoverview Babel transform to fix CommonJS exports compatibility.
 * Uses Babel AST walkers + magic-string for surgical transformations.
 *
 * Transforms:
 * - exports.default = value → module.exports = value
 * - Removes __esModule markers
 * - Fixes .default accessor in imports
 *
 * Pattern: Babel AST for analysis + magic-string for source manipulation.
 */

import { promises as fs } from 'node:fs'
import { isBuiltin } from 'node:module'
import path from 'node:path'

import { parse } from '@babel/parser'
import traverseModule from '@babel/traverse'
import * as t from '@babel/types'
import MagicString from 'magic-string'

// Pinned versions required:
// - @babel/parser@7.28.4
// - @babel/traverse@7.28.4
// - @babel/types@7.28.4
// - magic-string@0.30.19

const traverse = traverseModule.default

/**
 * Parse JavaScript code into AST.
 */
function parseCode(code) {
  return parse(code, {
    allowImportExportEverywhere: true,
    allowReturnOutsideFunction: true,
    sourceType: 'module',
  })
}

/**
 * Check if AST node is exports.default assignment.
 */
function isExportsDefaultAssignment(node) {
  return (
    t.isAssignmentExpression(node) &&
    t.isMemberExpression(node.left) &&
    t.isIdentifier(node.left.object, { name: 'exports' }) &&
    t.isIdentifier(node.left.property, { name: 'default' })
  )
}

/**
 * Check if AST node is __esModule marker.
 */
function isESModuleMarker(node) {
  return (
    t.isCallExpression(node) &&
    t.isMemberExpression(node.callee) &&
    t.isIdentifier(node.callee.object, { name: 'Object' }) &&
    t.isIdentifier(node.callee.property, { name: 'defineProperty' }) &&
    node.arguments.length >= 2 &&
    t.isIdentifier(node.arguments[0], { name: 'exports' }) &&
    t.isStringLiteral(node.arguments[1], { value: '__esModule' })
  )
}

/**
 * Transform a file to fix CommonJS exports.
 */
export async function transformFile(filePath, options = {}) {
  const { keepDefaultExport = new Set(), logger } = options

  const filename = path.basename(filePath)
  const dirname = path.basename(path.dirname(filePath))

  // Skip files that need to keep default export.
  if (keepDefaultExport.has(filename)) {
    return { modified: false }
  }

  // Skip non-js files.
  if (!filename.endsWith('.js')) {
    return { modified: false }
  }

  const content = await fs.readFile(filePath, 'utf8')
  const magicString = new MagicString(content)

  // Special handling for constants/index.js aggregation file.
  if (filename === 'index.js' && dirname === 'constants') {
    const searchStr = 'exports.default = (0, objects_1.createConstantsObject)'
    const replaceStr = 'module.exports = (0, objects_1.createConstantsObject)'
    const index = content.indexOf(searchStr)
    if (index !== -1) {
      magicString.overwrite(index, index + searchStr.length, replaceStr)
      await fs.writeFile(filePath, magicString.toString(), 'utf8')
      return { dirname, filename, modified: true, moduleName: 'index' }
    }
  }

  try {
    const ast = parseCode(content)
    let hasDefaultExport = false
    let hasOtherExports = false
    let modified = false
    const nodesToRemove = []

    // First pass: analyze exports.
    traverse(ast, {
      AssignmentExpression(path) {
        const { node } = path
        if (isExportsDefaultAssignment(node)) {
          hasDefaultExport = true
        } else if (
          t.isMemberExpression(node.left) &&
          t.isIdentifier(node.left.object, { name: 'exports' }) &&
          !t.isIdentifier(node.left.property, { name: 'default' })
        ) {
          hasOtherExports = true
        }
      },
    })

    // Second pass: transform if safe (only default export).
    if (hasDefaultExport && !hasOtherExports) {
      traverse(ast, {
        ExpressionStatement(path) {
          const { node } = path

          // Replace exports.default = value with module.exports = value.
          if (
            t.isAssignmentExpression(node.expression) &&
            isExportsDefaultAssignment(node.expression)
          ) {
            const start = node.start
            const exportsDefaultStr = 'exports.default'
            const index = content.indexOf(exportsDefaultStr, start)
            if (index !== -1) {
              magicString.overwrite(
                index,
                index + exportsDefaultStr.length,
                'module.exports',
              )
              modified = true
            }
          }
          // Mark __esModule markers for removal.
          else if (
            t.isCallExpression(node.expression) &&
            isESModuleMarker(node.expression)
          ) {
            nodesToRemove.push(node)
          }
        },
      })
    }

    // Remove __esModule markers if we made modifications.
    if (modified) {
      for (const node of nodesToRemove) {
        if (node.start !== null && node.end !== null) {
          let end = node.end
          // Include trailing semicolon and newline.
          if (content[end] === ';') {
            end += 1
          }
          if (content[end] === '\n') {
            end += 1
          }
          magicString.remove(node.start, end)
        }
      }

      await fs.writeFile(filePath, magicString.toString(), 'utf8')

      const moduleName = filename.replace('.js', '')
      return { dirname, filename, modified: true, moduleName }
    }
  } catch (e) {
    if (logger) {
      logger.warn(`Could not parse ${filePath}: ${e.message}`)
    }
  }

  return { modified: false }
}

/**
 * Fix .default accessors in imports.
 */
export async function fixImports(filePath, fixedModules, options = {}) {
  const { logger } = options

  const content = await fs.readFile(filePath, 'utf8')
  const magicString = new MagicString(content)
  let modified = false

  try {
    const ast = parseCode(content)

    traverse(ast, {
      // Fix: require('./constants/X').default → require('./constants/X')
      CallExpression(path) {
        const { node } = path
        if (
          !t.isIdentifier(node.callee, { name: 'require' }) ||
          !t.isStringLiteral(node.arguments[0])
        ) {
          return
        }

        const modulePath = node.arguments[0].value
        const moduleName = extractModuleName(modulePath)

        if (moduleName && fixedModules.has(moduleName)) {
          const parent = path.parent
          if (
            t.isMemberExpression(parent) &&
            parent.object === node &&
            t.isIdentifier(parent.property, { name: 'default' })
          ) {
            // Remove .default accessor (include the dot).
            const start = parent.property.start - 1
            const end = parent.property.end
            magicString.remove(start, end)
            modified = true
          }
        }
      },

      // Fix: variableName_1.default → variableName_1
      MemberExpression(path) {
        const { node } = path
        if (
          !t.isIdentifier(node.object) ||
          !t.isIdentifier(node.property, { name: 'default' }) ||
          !/_\d+$/.test(node.object.name)
        ) {
          return
        }

        const varName = node.object.name
        let requirePath = null

        // Find the require statement for this variable.
        traverse(ast, {
          VariableDeclarator(declPath) {
            if (
              t.isIdentifier(declPath.node.id, { name: varName }) &&
              t.isCallExpression(declPath.node.init) &&
              t.isIdentifier(declPath.node.init.callee, { name: 'require' }) &&
              t.isStringLiteral(declPath.node.init.arguments[0])
            ) {
              requirePath = declPath.node.init.arguments[0].value
              declPath.stop()
            }
          },
        })

        if (requirePath) {
          const isNodeBuiltin = isBuiltin(requirePath)
          const moduleName = extractModuleName(requirePath)
          const shouldFix = isNodeBuiltin || fixedModules.has(moduleName)

          if (shouldFix) {
            // Remove .default accessor (include the dot).
            const start = node.property.start - 1
            const end = node.property.end
            magicString.remove(start, end)
            modified = true
          }
        }
      },
    })

    if (modified) {
      await fs.writeFile(filePath, magicString.toString(), 'utf8')
      return { filename: path.basename(filePath), modified: true }
    }
  } catch (e) {
    if (logger) {
      logger.warn(`Could not parse ${filePath}: ${e.message}`)
    }
  }

  return { modified: false }
}

/**
 * Extract module name from require path.
 */
function extractModuleName(modulePath) {
  if (modulePath.includes('/constants/')) {
    const match = modulePath.match(/\/constants\/([^/]+)$/)
    return match ? match[1] : null
  }
  if (modulePath.includes('/external/')) {
    const match = modulePath.match(/\/external\/(.+)$/)
    return match ? match[1] : null
  }
  const match = modulePath.match(/\/([^/]+)$/)
  return match ? match[1].replace(/-/g, '-') : null
}
