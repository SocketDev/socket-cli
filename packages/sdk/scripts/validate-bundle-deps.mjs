/**
 * @fileoverview Validates that bundled vs external dependencies are correctly declared in package.json.
 *
 * Rules:
 * - Bundled packages (code copied into dist/) should be in devDependencies
 * - External packages (require() calls in dist/) should be in dependencies or peerDependencies
 * - Packages used only for building should be in devDependencies
 *
 * This ensures consumers install only what they need.
 */

import { promises as fs } from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')

// Node.js builtins to ignore (including node: prefix variants)
const BUILTIN_MODULES = new Set([
  ...builtinModules,
  ...builtinModules.map(m => `node:${m}`),
])

/**
 * Find all JavaScript files in dist directory.
 */
async function findDistFiles(distPath) {
  const files = []

  try {
    const entries = await fs.readdir(distPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(distPath, entry.name)

      if (entry.isDirectory()) {
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
 * Check if a string is a valid package specifier.
 */
function isValidPackageSpecifier(specifier) {
  // Relative imports
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    return false
  }

  // Subpath imports (Node.js internal imports starting with #)
  if (specifier.startsWith('#')) {
    return false
  }

  // Filter out invalid patterns
  if (
    specifier.includes('${') ||
    specifier.includes('"}') ||
    specifier.includes('`') ||
    specifier === 'true' ||
    specifier === 'false' ||
    specifier === 'null' ||
    specifier === 'undefined' ||
    specifier === 'name' ||
    specifier === 'dependencies' ||
    specifier === 'devDependencies' ||
    specifier === 'peerDependencies' ||
    specifier === 'version' ||
    specifier === 'description' ||
    specifier.length === 0 ||
    // Filter out strings that look like code fragments
    specifier.includes('\n') ||
    specifier.includes(';') ||
    specifier.includes('function') ||
    specifier.includes('const ') ||
    specifier.includes('let ') ||
    specifier.includes('var ')
  ) {
    return false
  }

  return true
}

/**
 * Extract external package names from require() and import statements in built files.
 */
async function extractExternalPackages(filePath) {
  const content = await fs.readFile(filePath, 'utf8')
  const externals = new Set()

  // Match require('package') or require("package")
  const requirePattern = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  // Match import from 'package' or import from "package"
  const importPattern = /(?:from|import)\s+['"]([^'"]+)['"]/g
  // Match dynamic import() calls
  const dynamicImportPattern = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g

  let match

  // Extract from require()
  while ((match = requirePattern.exec(content)) !== null) {
    const specifier = match[1]
    // Skip internal src/external/ wrapper paths (used by socket-lib pattern)
    if (specifier.includes('/external/')) {
      continue
    }
    if (isValidPackageSpecifier(specifier)) {
      externals.add(specifier)
    }
  }

  // Extract from import statements
  while ((match = importPattern.exec(content)) !== null) {
    const specifier = match[1]
    // Skip internal src/external/ wrapper paths (used by socket-lib pattern)
    if (specifier.includes('/external/')) {
      continue
    }
    if (isValidPackageSpecifier(specifier)) {
      externals.add(specifier)
    }
  }

  // Extract from dynamic import()
  while ((match = dynamicImportPattern.exec(content)) !== null) {
    const specifier = match[1]
    // Skip internal src/external/ wrapper paths (used by socket-lib pattern)
    if (specifier.includes('/external/')) {
      continue
    }
    if (isValidPackageSpecifier(specifier)) {
      externals.add(specifier)
    }
  }

  return externals
}

/**
 * Extract bundled package names from node_modules paths in comments and code.
 */
async function extractBundledPackages(filePath) {
  const content = await fs.readFile(filePath, 'utf8')
  const bundled = new Set()

  // Match node_modules paths in comments: node_modules/.pnpm/@scope+package@version/...
  // or node_modules/@scope/package/...
  // or node_modules/package/...
  const nodeModulesPattern =
    /node_modules\/(?:\.pnpm\/)?(@[^/]+\+[^@/]+|@[^/]+\/[^/]+|[^/@]+)/g

  let match
  while ((match = nodeModulesPattern.exec(content)) !== null) {
    let packageName = match[1]

    // Handle pnpm path format: @scope+package -> @scope/package
    if (packageName.includes('+')) {
      packageName = packageName.replace('+', '/')
    }

    // Filter out invalid package names (contains special chars, code fragments, etc.)
    if (
      packageName.includes('"') ||
      packageName.includes("'") ||
      packageName.includes('`') ||
      packageName.includes('${') ||
      packageName.includes('\\') ||
      packageName.includes(';') ||
      packageName.includes('\n') ||
      packageName.includes('function') ||
      packageName.includes('const') ||
      packageName.includes('let') ||
      packageName.includes('var') ||
      packageName.includes('=') ||
      packageName.includes('{') ||
      packageName.includes('}') ||
      packageName.includes('[') ||
      packageName.includes(']') ||
      packageName.includes('(') ||
      packageName.includes(')') ||
      // Filter out common false positives (strings that appear in code but aren't packages)
      packageName === 'bin' ||
      packageName === '.bin' ||
      packageName === 'npm' ||
      packageName === 'node' ||
      packageName === 'pnpm' ||
      packageName === 'yarn' ||
      packageName.length === 0 ||
      // npm package name max length
      packageName.length > 214
    ) {
      continue
    }

    bundled.add(packageName)
  }

  return bundled
}

/**
 * Get package name from a module specifier (strip subpaths).
 */
function getPackageName(specifier) {
  // Relative imports are not packages
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    return null
  }

  // Subpath imports (Node.js internal imports starting with #)
  if (specifier.startsWith('#')) {
    return null
  }

  // Filter out template strings, boolean strings, and other non-package patterns
  if (
    specifier.includes('${') ||
    specifier.includes('"}') ||
    specifier.includes('`') ||
    specifier === 'true' ||
    specifier === 'false' ||
    specifier === 'null' ||
    specifier === 'undefined' ||
    specifier.length === 0 ||
    // Filter out strings that look like code fragments
    specifier.includes('\n') ||
    specifier.includes(';') ||
    specifier.includes('function') ||
    specifier.includes('const ') ||
    specifier.includes('let ') ||
    specifier.includes('var ') ||
    // Filter out common non-package strings
    specifier.includes('"') ||
    specifier.includes("'") ||
    specifier.includes('\\')
  ) {
    return null
  }

  // Scoped package: @scope/package or @scope/package/subpath
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/')
    if (parts.length >= 2) {
      return `${parts[0]}/${parts[1]}`
    }
    return null
  }

  // Regular package: package or package/subpath
  const parts = specifier.split('/')
  return parts[0]
}

/**
 * Read and parse package.json.
 */
async function readPackageJson() {
  const packageJsonPath = path.join(rootPath, 'package.json')
  const content = await fs.readFile(packageJsonPath, 'utf8')
  return JSON.parse(content)
}

/**
 * Validate bundle dependencies.
 */
async function validateBundleDeps() {
  const distPath = path.join(rootPath, 'dist')
  const pkg = await readPackageJson()

  const dependencies = new Set(Object.keys(pkg.dependencies || {}))
  const devDependencies = new Set(Object.keys(pkg.devDependencies || {}))
  const peerDependencies = new Set(Object.keys(pkg.peerDependencies || {}))

  // Find all dist files
  const distFiles = await findDistFiles(distPath)

  if (distFiles.length === 0) {
    console.log('ℹ No dist files found - run build first')
    return { violations: [], warnings: [] }
  }

  // Collect all external and bundled packages
  const allExternals = new Set()
  const allBundled = new Set()

  for (const file of distFiles) {
    const externals = await extractExternalPackages(file)
    const bundled = await extractBundledPackages(file)

    for (const ext of externals) {
      const packageName = getPackageName(ext)
      if (packageName && !BUILTIN_MODULES.has(packageName)) {
        allExternals.add(packageName)
      }
    }

    for (const bun of bundled) {
      allBundled.add(bun)
    }
  }

  const violations = []
  const warnings = []

  // Validate external packages are in dependencies or peerDependencies
  for (const packageName of allExternals) {
    if (!dependencies.has(packageName) && !peerDependencies.has(packageName)) {
      violations.push({
        type: 'external-not-in-deps',
        package: packageName,
        message: `External package "${packageName}" is marked external but not in dependencies`,
        fix: devDependencies.has(packageName)
          ? `RECOMMENDED: Remove "${packageName}" from esbuild's "external" array to bundle it (keep in devDependencies)\n  OR: Move "${packageName}" to dependencies if it must stay external`
          : `RECOMMENDED: Remove "${packageName}" from esbuild's "external" array to bundle it\n  OR: Add "${packageName}" to dependencies if it must stay external`,
      })
    }
  }

  // Validate bundled packages are in devDependencies (not dependencies)
  for (const packageName of allBundled) {
    if (dependencies.has(packageName)) {
      violations.push({
        type: 'bundled-in-deps',
        package: packageName,
        message: `Bundled package "${packageName}" should be in devDependencies, not dependencies`,
        fix: `Move "${packageName}" from dependencies to devDependencies (code is bundled into dist/)`,
      })
    }

    if (!devDependencies.has(packageName) && !dependencies.has(packageName)) {
      warnings.push({
        type: 'bundled-not-declared',
        package: packageName,
        message: `Bundled package "${packageName}" is not declared in devDependencies`,
        fix: `Add "${packageName}" to devDependencies`,
      })
    }
  }

  return { violations, warnings }
}

async function main() {
  try {
    const { violations, warnings } = await validateBundleDeps()

    if (violations.length === 0 && warnings.length === 0) {
      console.log('✓ Bundle dependencies validation passed')
      process.exitCode = 0
      return
    }

    if (violations.length > 0) {
      console.error('❌ Bundle dependencies validation failed\n')

      for (const violation of violations) {
        console.error(`  ${violation.message}`)
        console.error(`  ${violation.fix}`)
        console.error('')
      }
    }

    if (warnings.length > 0) {
      console.log('⚠ Warnings:\n')

      for (const warning of warnings) {
        console.log(`  ${warning.message}`)
        console.log(`  ${warning.fix}\n`)
      }
    }

    // Only fail on violations, not warnings
    process.exitCode = violations.length > 0 ? 1 : 0
  } catch (error) {
    console.error('Validation failed:', error.message)
    process.exitCode = 1
  }
}

main()
