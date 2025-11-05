/**
 * @fileoverview Local package resolution for development.
 * Checks for local workspace or sibling project versions.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * Check if local workspace or sibling project versions exist.
 * Used for development to use local changes instead of published packages.
 *
 * @param {string} packageName - The package name to search for
 * @param {string} rootDir - The root directory of the project
 * @returns {Promise<string|null>} Path to local package or null
 */
export async function getLocalPackagePath(packageName, rootDir) {
  const checks = []

  // Check workspace packages (e.g. @socketregistry/yocto-spinner).
  if (packageName.startsWith('@socketregistry/')) {
    const pkgName = packageName.replace('@socketregistry/', '')
    const workspacePath = path.resolve(
      rootDir,
      '..',
      'packages',
      'npm',
      pkgName,
    )
    checks.push(workspacePath)
  }

  // Check sibling projects (e.g. socket-packageurl-js).
  if (packageName === '@socketregistry/packageurl-js') {
    const siblingPath = path.resolve(
      rootDir,
      '..',
      '..',
      'socket-packageurl-js',
    )
    checks.push(siblingPath)
  }

  // Return first existing path.
  for (const checkPath of checks) {
    try {
      await fs.access(path.join(checkPath, 'package.json'))
      return checkPath
    } catch {
      // Path doesn't exist, continue.
    }
  }

  return null
}

/**
 * Resolve the entry point for a local package.
 *
 * @param {string} localPath - Path to the local package
 * @returns {Promise<string>} Entry point path
 */
export async function resolveLocalEntryPoint(localPath) {
  const localPkgJson = JSON.parse(
    await fs.readFile(path.join(localPath, 'package.json'), 'utf8'),
  )

  // Resolve the main export - handle nested exports structure.
  let mainExport = localPkgJson.main || 'index.js'
  const exportsField = localPkgJson.exports?.['.']

  if (exportsField) {
    if (typeof exportsField === 'string') {
      mainExport = exportsField
    } else if (typeof exportsField === 'object') {
      // Try to find default export in nested structure.
      mainExport =
        exportsField.node?.default?.default ||
        exportsField.node?.default ||
        exportsField.default?.default ||
        exportsField.default ||
        mainExport
    }
  }

  return path.join(localPath, mainExport)
}
