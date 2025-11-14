/**
 * @fileoverview Validates that bundled vs external dependencies are correctly declared in package.json.
 *
 * Rules:
 * - Bundled packages (code copied into dist/) should be in devDependencies
 * - External packages (in esbuild external array) should be in dependencies or peerDependencies
 * - Packages used only for building should be in devDependencies
 *
 * This ensures consumers install only what they need.
 */

import { promises as fs } from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')
const cliPackagePath = path.join(rootPath, 'packages/cli')

// Node.js builtins to ignore (including node: prefix variants).
const BUILTIN_MODULES = new Set([
  ...builtinModules,
  ...builtinModules.map(m => `node:${m}`),
])

// Packages that are marked external but are excused from validation.
// These are packages referenced in bundled code that's never actually called.
const EXCUSED_EXTERNALS = new Set([
  'node-gyp',
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
 * Extract external packages from esbuild config files.
 */
async function extractExternalsFromConfigs() {
  const externals = new Set()
  const configFiles = [
    path.join(cliPackagePath, '.config/esbuild.cli.build.mjs'),
    path.join(cliPackagePath, '.config/esbuild.inject.config.mjs'),
    path.join(cliPackagePath, '.config/esbuild.index.config.mjs'),
  ]

  for (const configFile of configFiles) {
    try {
      const content = await fs.readFile(configFile, 'utf8')
      // Extract external array from config.
      // Look for: external: [...] pattern.
      const externalMatch = content.match(/external\s*:\s*\[([\s\S]*?)\]/m)
      if (externalMatch) {
        const externalContent = externalMatch[1]
        // Extract quoted strings from the array.
        const packageMatches = externalContent.matchAll(/['"]([^'"]+)['"]/g)
        for (const match of packageMatches) {
          const packageName = getPackageName(match[1])
          if (packageName && !BUILTIN_MODULES.has(packageName)) {
            externals.add(packageName)
          }
        }
      }
    } catch (e) {
      // Config file doesn't exist or can't be read.
      continue
    }
  }

  return externals
}

/**
 * Check if a package is a direct dependency (not transitive).
 */
async function isDirectDependency(packageName, devDependencies) {
  // If it's in devDependencies, it's direct.
  if (devDependencies.has(packageName)) {
    return true
  }

  // Check if it's imported in source files.
  try {
    const srcPath = path.join(cliPackagePath, 'src')
    const srcFiles = await findSourceFiles(srcPath)

    for (const file of srcFiles) {
      const content = await fs.readFile(file, 'utf8')
      // Check for direct imports: from 'package-name' or from "package-name"
      // For scoped packages: from '@scope/package' or from "@scope/package"
      const importPattern = new RegExp(
        `from\\s+['"]${packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:['"/]|$)`,
        'm'
      )
      if (importPattern.test(content)) {
        return true
      }
    }
  } catch {
    // If we can't determine, assume it's direct to be safe.
    return true
  }

  return false
}

/**
 * Find all source files in a directory.
 */
async function findSourceFiles(srcPath) {
  const files = []

  try {
    const entries = await fs.readdir(srcPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(srcPath, entry.name)

      if (entry.isDirectory()) {
        files.push(...(await findSourceFiles(fullPath)))
      } else if (
        entry.name.endsWith('.ts') ||
        entry.name.endsWith('.mts') ||
        entry.name.endsWith('.cts') ||
        entry.name.endsWith('.js') ||
        entry.name.endsWith('.mjs') ||
        entry.name.endsWith('.cjs')
      ) {
        files.push(fullPath)
      }
    }
  } catch {
    return []
  }

  return files
}

/**
 * Validate bundle dependencies.
 */
async function validateBundleDeps() {
  const distPath = path.join(cliPackagePath, 'build')
  const packageJsonPath = path.join(cliPackagePath, 'package.json')
  const pkg = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'))

  const dependencies = new Set(Object.keys(pkg.dependencies || {}))
  const devDependencies = new Set(Object.keys(pkg.devDependencies || {}))
  const peerDependencies = new Set(Object.keys(pkg.peerDependencies || {}))

  // Find all dist files.
  const distFiles = await findDistFiles(distPath)

  if (distFiles.length === 0) {
    logger.info('No build files found - run build first')
    return { violations: [], warnings: [] }
  }

  // Get external packages from esbuild configs.
  const allExternals = await extractExternalsFromConfigs()

  // Collect bundled packages from dist files.
  const allBundled = new Set()

  for (const file of distFiles) {
    const bundled = await extractBundledPackages(file)
    for (const bun of bundled) {
      allBundled.add(bun)
    }
  }

  const violations = []
  const warnings = []

  // Validate external packages are in dependencies or peerDependencies.
  for (const packageName of allExternals) {
    if (EXCUSED_EXTERNALS.has(packageName)) {
      continue
    }
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

  // Validate bundled packages are in devDependencies (not dependencies).
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
      // Only warn about direct dependencies that are missing.
      // Transitive dependencies are expected to be bundled but not declared.
      const isDirect = await isDirectDependency(packageName, devDependencies)
      if (isDirect) {
        warnings.push({
          type: 'bundled-not-declared',
          package: packageName,
          message: `Bundled package "${packageName}" is not declared in devDependencies`,
          fix: `Add "${packageName}" to devDependencies`,
        })
      }
    }
  }

  return { violations, warnings }
}

async function main() {
  try {
    const { violations, warnings } = await validateBundleDeps()

    if (violations.length === 0 && warnings.length === 0) {
      logger.success('Bundle dependencies validation passed')
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
