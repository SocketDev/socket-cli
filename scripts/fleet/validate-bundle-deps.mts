/* eslint-disable no-shadow -- nested cached-length for-loops intentionally reuse `i`/`length` names for the fleet-wide cached-loop idiom; renaming would diverge from the codebase pattern. */
/**
 * @file Validates that bundled vs external dependencies are correctly declared
 *   in package.json. Rules:
 *
 *   - Bundled packages (code copied into dist/) should be in devDependencies
 *   - External packages (require() calls in dist/) should be in dependencies or
 *     peerDependencies
 *   - Packages used only for building should be in devDependencies This ensures
 *     consumers install only what they need.
 */

import { promises as fs } from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from './paths.mts'
import { isMainModule } from './_shared/is-main-module.mts'

const logger = getDefaultLogger()

const rootPath = REPO_ROOT

// Node.js builtins to ignore (including node: prefix variants).
// node:smol-* are Socket SEA-bundled optional builtins (smol-util, smol-primordial);
// they appear in dist behind `mod.isBuiltin('node:smol-util')` guards and are only
// resolvable in SEA binaries, so they should never be expected in dependencies.
const SOCKET_SEA_BUILTINS = ['node:smol-util', 'node:smol-primordial']
const BUILTIN_MODULES = new Set([
  ...builtinModules,
  ...builtinModules.map(m => `node:${m}`),
  ...SOCKET_SEA_BUILTINS,
])

/**
 * Find all JavaScript files in dist directory.
 */
export async function findDistFiles(distPath: string): Promise<string[]> {
  const files: string[] = []

  try {
    const entries = await fs.readdir(distPath, { withFileTypes: true })

    for (let i = 0, { length } = entries; i < length; i += 1) {
      const entry = entries[i]!
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
export function isValidPackageSpecifier(specifier: string): boolean {
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
 * Extract external package names from require() and import statements in built
 * files.
 */
export async function extractExternalPackages(
  filePath: string,
): Promise<Set<string>> {
  const content = await fs.readFile(filePath, 'utf8')
  const externals = new Set<string>()

  // Match require('package') or require("package")
  const requirePattern = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  // Match import from 'package' or import from "package"
  const importPattern = /(?:from|import)\s+['"]([^'"]+)['"]/g
  // Match dynamic import() calls
  const dynamicImportPattern = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g

  let match: RegExpExecArray | null

  // Extract from require()
  while ((match = requirePattern.exec(content)) !== null) {
    const specifier = match[1]
    if (!specifier) {
      continue
    }
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
    if (!specifier) {
      continue
    }
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
    if (!specifier) {
      continue
    }
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
export async function extractBundledPackages(
  filePath: string,
): Promise<Set<string>> {
  const content = await fs.readFile(filePath, 'utf8')
  const bundled = new Set<string>()

  // Match node_modules paths in comments: node_modules/.pnpm/@scope+package@version/...
  // or node_modules/@scope/package/...
  // or node_modules/package/...
  const nodeModulesPattern =
    /node_modules\/(?:\.pnpm\/)?(@[^/]+\+[^@/]+|@[^/]+\/[^/]+|[^/@]+)/g

  let match: RegExpExecArray | null
  while ((match = nodeModulesPattern.exec(content)) !== null) {
    let packageName = match[1]
    if (!packageName) {
      continue
    }

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
export function getPackageName(specifier: string): string | undefined {
  // Relative imports are not packages
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    return undefined
  }

  // Subpath imports (Node.js internal imports starting with #)
  if (specifier.startsWith('#')) {
    return undefined
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
    return undefined
  }

  // Scoped package: @scope/package or @scope/package/subpath
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/')
    if (parts.length >= 2) {
      return `${parts[0]}/${parts[1]}`
    }
    return undefined
  }

  // Regular package: package or package/subpath
  const parts = specifier.split('/')
  return parts[0] || undefined
}

interface PackageJson {
  name?: string | undefined
  version?: string | undefined
  main?: string | undefined
  types?: string | undefined
  dependencies?: Record<string, string> | undefined
  devDependencies?: Record<string, string> | undefined
  peerDependencies?: Record<string, string> | undefined
  optionalDependencies?: Record<string, string> | undefined
  exports?: Record<string, string | Record<string, string>> | undefined
}

/**
 * Read and parse package.json.
 */
async function readPackageJson(): Promise<PackageJson> {
  const packageJsonPath = path.join(rootPath, 'package.json')
  const content = await fs.readFile(packageJsonPath, 'utf8')
  try {
    return JSON.parse(content)
  } catch (e) {
    throw new Error(
      `Failed to parse ${packageJsonPath}: ${e instanceof Error ? e.message : 'Unknown error'}`,
      { cause: e },
    )
  }
}

interface Violation {
  type: string
  package: string
  message: string
  fix: string
}

interface Warning {
  type: string
  package: string
  message: string
  fix: string
}

interface ValidationResult {
  violations: Violation[]
  warnings: Warning[]
}

/**
 * Validate bundle dependencies.
 */
async function validateBundleDeps(): Promise<ValidationResult> {
  const distPath = path.join(rootPath, 'dist')
  const pkg = await readPackageJson()

  const dependencies = new Set(Object.keys(pkg.dependencies || {}))
  const devDependencies = new Set(Object.keys(pkg.devDependencies || {}))
  const peerDependencies = new Set(Object.keys(pkg.peerDependencies || {}))

  // Find all dist files
  const distFiles = await findDistFiles(distPath)

  if (distFiles.length === 0) {
    logger.info('No dist files found - run build first')
    return { violations: [], warnings: [] }
  }

  // Collect all external and bundled packages
  const allExternals = new Set<string>()
  const allBundled = new Set<string>()

  for (let i = 0, { length } = distFiles; i < length; i += 1) {
    const file = distFiles[i]!
    const externals = await extractExternalPackages(file)
    const bundled = await extractBundledPackages(file)

    // externals + bundled are Set<string> — use for...of, the
    // canonical fix for set / map / iterable iteration.
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

  const violations: Violation[] = []
  const warnings: Warning[] = []

  // Validate external packages are in dependencies or peerDependencies.
  // allExternals / allBundled are Sets — use for...of.
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

async function main(): Promise<void> {
  try {
    const { violations, warnings } = await validateBundleDeps()

    if (violations.length === 0 && warnings.length === 0) {
      logger.success('Bundle dependencies validation passed')
      process.exitCode = 0
      return
    }

    if (violations.length > 0) {
      logger.fail('Bundle dependencies validation failed')
      logger.error('')

      for (let i = 0, { length } = violations; i < length; i += 1) {
        const violation = violations[i]!
        logger.error(`  ${violation.message}`)
        logger.error(`  ${violation.fix}`)
        logger.error('')
      }
    }

    if (warnings.length > 0) {
      logger.warn('Warnings:')
      logger.error('')

      for (let i = 0, { length } = warnings; i < length; i += 1) {
        const warning = warnings[i]!
        logger.log(`  ${warning.message}`)
        logger.log(`  ${warning.fix}`)
        logger.log('')
      }
    }

    // Only fail on violations, not warnings
    process.exitCode = violations.length > 0 ? 1 : 0
  } catch (e) {
    logger.error('Validation failed:', errorMessage(e))
    process.exitCode = 1
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error('Unhandled error in main():', e)
    process.exitCode = 1
  })
}
