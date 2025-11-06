/**
 * @fileoverview Validates that all require() calls in dist/ resolve to valid dependencies or files.
 *
 * Uses @babel/parser to accurately detect require() specifiers and validates:
 * - Bare specifiers (package names) must be Node.js built-ins or in dependencies/peerDependencies
 * - Relative specifiers (./file or ../file) must point to existing files
 *
 * Rules:
 * - External packages (require() calls in dist/) must be in dependencies or peerDependencies
 * - Bundled packages should NOT appear as require() calls (code is bundled/inlined)
 * - devDependencies should NOT be required from dist/ (not installed by consumers)
 * - Relative imports must resolve to existing files in dist/
 *
 * This ensures consumers can run the published package.
 */

import { existsSync, promises as fs } from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse } from '@babel/parser'
import traverseModule from '@babel/traverse'
import * as t from '@babel/types'

const traverse = traverseModule.default

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')

// Node.js builtins to recognize (including node: prefix variants)
const BUILTIN_MODULES = new Set([
  ...builtinModules,
  ...builtinModules.map(m => `node:${m}`),
])

/**
 * Parse JavaScript code into AST
 */
function parseCode(code, filePath) {
  try {
    return parse(code, {
      allowImportExportEverywhere: true,
      allowReturnOutsideFunction: true,
      sourceType: 'unambiguous',
    })
  } catch (error) {
    throw new Error(`Failed to parse ${filePath}: ${error.message}`)
  }
}

/**
 * Extract all require() specifiers from a file using Babel AST
 */
async function extractRequireSpecifiers(filePath) {
  const content = await fs.readFile(filePath, 'utf8')
  const ast = parseCode(content, filePath)
  const specifiers = []

  traverse(ast, {
    CallExpression(astPath) {
      const { node } = astPath

      // Check if this is a require() call
      if (
        t.isIdentifier(node.callee, { name: 'require' }) &&
        node.arguments.length > 0 &&
        t.isStringLiteral(node.arguments[0])
      ) {
        const specifier = node.arguments[0].value
        const { column, line } = node.loc.start
        specifiers.push({
          specifier,
          line,
          column,
        })
      }
    },
  })

  return specifiers
}

/**
 * Check if a specifier is a bare specifier (package name, not relative path)
 */
function isBareSpecifier(specifier) {
  return !specifier.startsWith('.') && !specifier.startsWith('/')
}

/**
 * Get package name from a bare specifier (strip subpaths)
 */
function getPackageName(specifier) {
  // Scoped package: @scope/package or @scope/package/subpath
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/')
    if (parts.length >= 2) {
      return `${parts[0]}/${parts[1]}`
    }
    return specifier
  }

  // Regular package: package or package/subpath
  const parts = specifier.split('/')
  return parts[0]
}

/**
 * Check if a relative require path resolves to an existing file
 */
function checkFileExists(specifier, fromFile) {
  const fromDir = path.dirname(fromFile)
  const extensions = ['', '.js', '.mjs', '.cjs', '.json', '.node']

  // Try with different extensions
  for (const ext of extensions) {
    const fullPath = path.resolve(fromDir, specifier + ext)
    if (existsSync(fullPath)) {
      return { exists: true, resolvedPath: fullPath }
    }
  }

  // Try as directory with index file
  const dirPath = path.resolve(fromDir, specifier)
  for (const indexFile of [
    'index.js',
    'index.mjs',
    'index.cjs',
    'index.json',
  ]) {
    const indexPath = path.join(dirPath, indexFile)
    if (existsSync(indexPath)) {
      return { exists: true, resolvedPath: indexPath }
    }
  }

  return { exists: false, resolvedPath: null }
}

/**
 * Find all JavaScript files in dist directory recursively
 */
async function findDistFiles(distPath) {
  const files = []

  try {
    const entries = await fs.readdir(distPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(distPath, entry.name)

      if (entry.isDirectory()) {
        // Check ALL directories including dist/external/
        files.push(...(await findDistFiles(fullPath)))
      } else if (
        entry.name.endsWith('.js') ||
        entry.name.endsWith('.mjs') ||
        entry.name.endsWith('.cjs')
      ) {
        files.push(fullPath)
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
    return []
  }

  return files
}

/**
 * Read and parse package.json
 */
async function readPackageJson() {
  const packageJsonPath = path.join(rootPath, 'package.json')
  const content = await fs.readFile(packageJsonPath, 'utf8')
  return JSON.parse(content)
}

/**
 * Validate require() calls in dist/ files
 */
async function validateNoExtraneousDependencies() {
  const pkg = await readPackageJson()

  const dependencies = new Set(Object.keys(pkg.dependencies || {}))
  const devDependencies = new Set(Object.keys(pkg.devDependencies || {}))
  const peerDependencies = new Set(Object.keys(pkg.peerDependencies || {}))

  // Find all JS files in dist/
  const distPath = path.join(rootPath, 'dist')
  const allFiles = await findDistFiles(distPath)

  if (allFiles.length === 0) {
    console.log('ℹ No dist files found - run build first')
    return { errors: [] }
  }

  const errors = []

  for (const file of allFiles) {
    try {
      const specifiers = await extractRequireSpecifiers(file)
      const relativePath = path.relative(rootPath, file)

      for (const { column, line, specifier } of specifiers) {
        // Skip subpath imports (# prefixed imports)
        if (specifier.startsWith('#')) {
          continue
        }

        // Skip internal src/external/ wrapper paths (used by socket-lib pattern)
        if (specifier.includes('/external/')) {
          continue
        }

        if (isBareSpecifier(specifier)) {
          // Check if it's a Node.js built-in
          const packageName = getPackageName(specifier)

          if (
            specifier.startsWith('node:') ||
            BUILTIN_MODULES.has(specifier) ||
            BUILTIN_MODULES.has(packageName)
          ) {
            // Built-in module, all good
            continue
          }

          // Check if package is in dependencies or peerDependencies
          // NOTE: devDependencies are NOT acceptable in dist/ - they don't get installed by consumers
          if (
            !dependencies.has(packageName) &&
            !peerDependencies.has(packageName)
          ) {
            const inDevDeps = devDependencies.has(packageName)
            errors.push({
              file: relativePath,
              line,
              column,
              specifier,
              packageName,
              type: 'missing-dependency',
              message: inDevDeps
                ? `Package "${packageName}" is in devDependencies but required in dist/ (should be in dependencies or bundled)`
                : `Package "${packageName}" is not declared in dependencies or peerDependencies`,
            })
          }
        } else {
          // Relative or absolute path - check if file exists
          const { exists } = checkFileExists(specifier, file)

          if (!exists) {
            errors.push({
              file: relativePath,
              line,
              column,
              specifier,
              type: 'missing-file',
              message: `File "${specifier}" does not exist`,
            })
          }
        }
      }
    } catch (error) {
      errors.push({
        file: path.relative(rootPath, file),
        type: 'parse-error',
        message: error.message,
      })
    }
  }

  return { errors }
}

async function main() {
  try {
    const { errors } = await validateNoExtraneousDependencies()

    if (errors.length === 0) {
      console.log('✓ No extraneous dependencies found')
      process.exitCode = 0
      return
    }

    console.error('✗ Found extraneous or missing dependencies:\n')

    for (const error of errors) {
      if (error.type === 'missing-dependency') {
        console.error(
          `  ${error.file}:${error.line}:${error.column} - ${error.message}`,
        )
        console.error(`    require('${error.specifier}')`)
        if (
          error.message.includes('is in devDependencies but required in dist/')
        ) {
          console.error(
            `    Fix: Move "${error.packageName}" to dependencies OR bundle it (add to esbuild external exclusion)\n`,
          )
        } else {
          console.error(
            `    Fix: Add "${error.packageName}" to dependencies or peerDependencies\n`,
          )
        }
      } else if (error.type === 'missing-file') {
        console.error(
          `  ${error.file}:${error.line}:${error.column} - ${error.message}`,
        )
        console.error(`    require('${error.specifier}')`)
        console.error('    Fix: Create the missing file or fix the path\n')
      } else if (error.type === 'parse-error') {
        console.error(`  ${error.file} - ${error.message}\n`)
      }
    }

    process.exitCode = 1
  } catch (error) {
    console.error('Validation failed:', error.message)
    process.exitCode = 1
  }
}

main()
