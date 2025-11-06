/**
 * @fileoverview Fix CommonJS exports for Node.js ESM compatibility.
 * Transforms esbuild's minified exports to clear module.exports = { ... } format.
 */

import { parse } from '@babel/parser'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import MagicString from 'magic-string'
import colors from 'yoctocolors-cjs'

import { isQuiet } from '#socketsecurity/lib/argv/flags'
import { getDefaultLogger } from '#socketsecurity/lib/logger'

const logger = getDefaultLogger()
const printCompletedHeader = title => console.log(colors.green(`✓ ${title}`))

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(__dirname, '..', 'dist')

/**
 * Extract named exports from esbuild's minified pattern.
 * Pattern: V(X,{exportName:()=>identifier,...});module.exports=z(X);
 *
 * @param {string} code - The file content
 * @returns {{ exports: Array<{name: string, identifier: string}>, match: RegExpMatchArray } | null}
 */
function extractEsbuildExports(code) {
  // First verify the code is valid JavaScript
  try {
    parse(code, {
      sourceType: 'module',
      plugins: [],
    })
  } catch {
    // If parsing fails, skip this file
    return null
  }

  // Pattern: V(X,{exportName:()=>identifier,...});module.exports=z(X);
  // where V is the export setter, X is the exports object, z adds __esModule
  const pattern = /V\((\w+),\{([^}]+)\}\);module\.exports=z\(\1\);/
  const match = code.match(pattern)

  if (!match) {
    return null
  }

  const exportsStr = match[2]

  // Parse the exports string: "exportName:()=>identifier,..."
  const exports = []
  const exportRegex = /(\w+):\(\)=>(\w+)/g
  let exportMatch
  while ((exportMatch = exportRegex.exec(exportsStr)) !== null) {
    exports.push({ name: exportMatch[1], identifier: exportMatch[2] })
  }

  if (exports.length === 0) {
    return null
  }

  return { exports, match }
}

/**
 * Process files in a directory and fix CommonJS exports.
 *
 * @param {string} dir - Directory to process
 * @param {boolean} verbose - Show individual file fixes
 * @returns {Promise<number>} Number of files fixed
 */
async function processDirectory(dir, verbose = false) {
  let fixedCount = 0

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        fixedCount += await processDirectory(fullPath, verbose)
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        const content = await fs.readFile(fullPath, 'utf8')
        const s = new MagicString(content)
        let modified = false

        // Transform esbuild's minified export pattern to clear CommonJS exports
        const exportsInfo = extractEsbuildExports(content)
        if (exportsInfo) {
          const { exports, match } = exportsInfo

          // Find the position of the match (this is early in the file, before definitions)
          const matchStart = match.index
          const matchEnd = matchStart + match[0].length

          // Remove the early export pattern
          s.remove(matchStart, matchEnd)

          // Find the stub at the end: 0&&(module.exports={...});
          // This is where we should place the actual exports
          const stubPattern = /0&&\(module\.exports=\{[^}]+\}\);/
          const stubMatch = content.match(stubPattern)

          // Build the clear CommonJS export
          const exportLines = exports
            .map(({ identifier, name }) => `  ${name}: ${identifier}`)
            .join(',\n')

          const replacement = `module.exports = {\n${exportLines}\n};`

          if (stubMatch && stubMatch.index !== undefined) {
            // Replace the stub with actual exports
            s.overwrite(
              stubMatch.index,
              stubMatch.index + stubMatch[0].length,
              replacement,
            )
          } else {
            // If no stub found, append at the end (before sourcemap comment)
            const sourcemapComment = '//# sourceMappingURL='
            const sourcemapIndex = content.lastIndexOf(sourcemapComment)
            if (sourcemapIndex !== -1) {
              s.appendLeft(sourcemapIndex, `\n${replacement}\n`)
            } else {
              s.append(`\n${replacement}\n`)
            }
          }

          modified = true
        }

        // Check if this is a single default export with __toCommonJS pattern
        if (
          content.includes('module.exports = __toCommonJS(') &&
          content.includes('default: () => ')
        ) {
          // Parse AST to find the export pattern and value identifier
          try {
            const ast = parse(content, {
              sourceType: 'module',
              plugins: [],
            })

            let valueIdentifier = null
            let exportCallStart = null
            let exportCallEnd = null
            let toCommonJSStart = null
            let toCommonJSEnd = null

            // Find __export call with default export
            const walk = node => {
              if (!node || typeof node !== 'object') {
                return
              }

              // Look for: __export(name, { default: () => value_identifier })
              if (
                node.type === 'CallExpression' &&
                node.callee?.type === 'Identifier' &&
                node.callee.name === '__export' &&
                node.arguments?.length === 2 &&
                node.arguments[1].type === 'ObjectExpression'
              ) {
                const defaultProp = node.arguments[1].properties?.find(
                  p =>
                    p.type === 'ObjectProperty' &&
                    p.key?.name === 'default' &&
                    p.value?.type === 'ArrowFunctionExpression',
                )
                if (defaultProp?.value.body?.name) {
                  valueIdentifier = defaultProp.value.body.name
                  exportCallStart = node.start
                  exportCallEnd = node.end
                }
              }

              // Look for: module.exports = __toCommonJS(name)
              if (
                node.type === 'AssignmentExpression' &&
                node.left?.type === 'MemberExpression' &&
                node.left.object?.name === 'module' &&
                node.left.property?.name === 'exports' &&
                node.right?.type === 'CallExpression' &&
                node.right.callee?.name === '__toCommonJS'
              ) {
                toCommonJSStart = node.start
                toCommonJSEnd = node.end
              }

              // Recursively walk
              for (const key of Object.keys(node)) {
                if (key === 'start' || key === 'end' || key === 'loc') {
                  continue
                }
                const value = node[key]
                if (Array.isArray(value)) {
                  for (const item of value) {
                    walk(item)
                  }
                } else {
                  walk(value)
                }
              }
            }

            walk(ast.program)

            if (
              valueIdentifier &&
              exportCallStart !== null &&
              toCommonJSStart !== null
            ) {
              // Remove the __export call and surrounding statement
              // Find the semicolon and newline after the call
              let removeEnd = exportCallEnd
              while (
                removeEnd < content.length &&
                (content[removeEnd] === ';' || content[removeEnd] === '\n')
              ) {
                removeEnd++
              }
              s.remove(exportCallStart, removeEnd)

              // Replace the entire statement: module.exports = __toCommonJS(name);
              // Find and include the semicolon
              let statementEnd = toCommonJSEnd
              while (
                statementEnd < content.length &&
                (content[statementEnd] === ';' ||
                  content[statementEnd] === ' ' ||
                  content[statementEnd] === '\n')
              ) {
                if (content[statementEnd] === ';') {
                  statementEnd++
                  break
                }
                statementEnd++
              }
              // Replace the entire statement with a comment
              s.overwrite(
                toCommonJSStart,
                statementEnd,
                '/* module.exports will be set at end of file */',
              )

              // Add module.exports at the end of the file
              s.append(`\nmodule.exports = ${valueIdentifier};\n`)

              modified = true
            }
          } catch {
            // If parsing fails, skip this optimization
          }
        }

        // Check if this is a single default export (legacy pattern)
        // Only match 'exports.default =' that is NOT preceded by 'module.' or 'moduleN.'
        if (content.includes('exports.default =')) {
          // Transform exports.default = value to module.exports = value
          let pos = 0
          while ((pos = content.indexOf('exports.default = ', pos)) !== -1) {
            // Check if this is preceded by 'module.' or 'moduleN.' (from esbuild CommonJS wrapper)
            const beforeModule = pos - 'module.'.length
            const beforeModule2 = pos - 'module2.'.length
            const isModule =
              beforeModule >= 0 &&
              content.slice(beforeModule, pos) === 'module.'
            const isModule2 =
              beforeModule2 >= 0 &&
              content.slice(beforeModule2, pos) === 'module2.'
            // Also check for generic moduleN. pattern
            const beforeText = content.slice(Math.max(0, pos - 10), pos)
            const hasModuleNPrefix = /module\d*\.$/.test(beforeText)

            if (isModule || isModule2 || hasModuleNPrefix) {
              // Skip moduleN.exports.default (it's already from esbuild wrapper)
              pos += 1
              continue
            }
            s.overwrite(
              pos,
              pos + 'exports.default = '.length,
              'module.exports = ',
            )
            pos += 1
            modified = true
          }

          // Remove the __esModule marker
          const esModuleMarker =
            'Object.defineProperty(exports, "__esModule", { value: true });'
          pos = content.indexOf(esModuleMarker)
          if (pos !== -1) {
            const endPos = pos + esModuleMarker.length
            // Check if there's a newline after
            if (content[endPos] === '\n') {
              s.remove(pos, endPos + 1)
            } else {
              s.remove(pos, endPos)
            }
            modified = true
          }
        }

        // Fix require().default references for fixed modules using AST
        try {
          const ast = parse(content, {
            sourceType: 'module',
            plugins: [],
          })

          // Walk the AST to find MemberExpression nodes with .default
          const walk = node => {
            if (!node || typeof node !== 'object') {
              return
            }

            // Look for patterns like: require("./module").default
            if (
              node.type === 'MemberExpression' &&
              node.property?.type === 'Identifier' &&
              node.property.name === 'default' &&
              node.object?.type === 'CallExpression' &&
              node.object.callee?.type === 'Identifier' &&
              node.object.callee.name === 'require' &&
              node.object.arguments?.length === 1 &&
              node.object.arguments[0].type === 'StringLiteral'
            ) {
              const modulePath = node.object.arguments[0].value
              // Only fix relative imports (not external packages)
              if (modulePath.startsWith('./') || modulePath.startsWith('../')) {
                // Remove the .default property access
                // Keep the require() call but remove .default
                s.remove(node.object.end, node.end)
                modified = true
              }
            }

            // Recursively walk all properties
            for (const key of Object.keys(node)) {
              if (key === 'start' || key === 'end' || key === 'loc') {
                continue
              }
              const value = node[key]
              if (Array.isArray(value)) {
                for (const item of value) {
                  walk(item)
                }
              } else {
                walk(value)
              }
            }
          }

          walk(ast.program)
        } catch {
          // If parsing fails, skip AST-based fixes for this file
        }

        // Fix module2.module.exports pattern (from external bundling)
        // This is always incorrect and causes "Cannot set properties of undefined"
        if (content.includes('module2.module.exports')) {
          // Find and remove all occurrences of module2.module.exports lines
          // Pattern matches: "    module2.module.exports = value;\n"
          const pattern =
            /[ \t]*module2\.module\.exports\s*=\s*[^;]+;[ \t]*\n?/g
          const matches = [...content.matchAll(pattern)]

          if (matches.length > 0) {
            if (verbose) {
              console.log(
                `    Removing ${matches.length} module2.module.exports lines from ${path.basename(fullPath)}`,
              )
            }

            // Process matches in reverse order to maintain correct indices
            for (let i = matches.length - 1; i >= 0; i--) {
              const match = matches[i]
              const start = match.index
              const end = start + match[0].length
              s.remove(start, end)
              modified = true
            }
          }
        }

        // Fix relative paths ONLY for files in the root dist directory
        const isRootFile = path.dirname(fullPath) === distDir
        if (
          isRootFile &&
          (content.includes('require("../') || content.includes("require('../"))
        ) {
          let pos = 0
          while ((pos = content.indexOf('require("../', pos)) !== -1) {
            s.overwrite(
              pos + 'require("'.length,
              pos + 'require("../'.length,
              './',
            )
            pos += 1
            modified = true
          }
          pos = 0
          while ((pos = content.indexOf("require('../", pos)) !== -1) {
            s.overwrite(
              pos + "require('".length,
              pos + "require('../".length,
              './',
            )
            pos += 1
            modified = true
          }
        }

        if (modified) {
          await fs.writeFile(fullPath, s.toString())
          if (verbose) {
            const relativePath = path.relative(distDir, fullPath)
            console.log(`    Fixed ${relativePath}`)
          }
          fixedCount += 1
        }
      }
    }
  } catch (error) {
    // Skip directories that don't exist
    if (error.code !== 'ENOENT') {
      throw error
    }
  }

  return fixedCount
}

async function fixConstantExports() {
  const verbose = process.argv.includes('--verbose')
  const quiet = isQuiet()

  try {
    const fixedCount = await processDirectory(distDir, verbose)

    if (!quiet) {
      const title =
        fixedCount > 0
          ? `CommonJS Exports (${fixedCount} file${fixedCount === 1 ? '' : 's'})`
          : 'CommonJS Exports (no changes)'
      printCompletedHeader(title)
    }
  } catch (error) {
    logger.error(`Failed to fix CommonJS exports: ${error.message}`)
    process.exitCode = 1
  }
}

fixConstantExports().catch(error => {
  logger.error(`Build failed: ${error.message || error}`)
  process.exitCode = 1
})
