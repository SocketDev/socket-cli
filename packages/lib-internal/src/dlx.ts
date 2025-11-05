/** @fileoverview DLX (execute package) utilities for Socket ecosystem shared installations. */

import { createHash } from 'crypto'

import { readDirNamesSync, safeDelete, safeMkdir, safeMkdirSync } from './fs'
import { normalizePath } from './path'
import { getSocketDlxDir } from './paths'
import { pEach } from './promises'

let _fs: typeof import('fs') | undefined
/**
 * Lazily load the fs module to avoid Webpack errors.
 * Uses non-'node:' prefixed require to prevent Webpack bundling issues.
 *
 * @returns The Node.js fs module
 * @private
 */
/*@__NO_SIDE_EFFECTS__*/
function getFs() {
  if (_fs === undefined) {
    // Use non-'node:' prefixed require to avoid Webpack errors.

    _fs = /*@__PURE__*/ require('node:fs')
  }
  return _fs as typeof import('fs')
}

/**
 * Generate a cache directory name using npm/npx approach.
 * Uses first 16 characters of SHA-512 hash (like npm/npx).
 *
 * Rationale for SHA-512 truncated (vs full SHA-256):
 * - Matches npm/npx ecosystem behavior
 * - Shorter paths for Windows MAX_PATH compatibility (260 chars)
 * - 16 hex chars = 64 bits = acceptable collision risk for local cache
 * - Collision probability ~1 in 18 quintillion with 1000 entries
 *
 * Input strategy (aligned with npx):
 * - npx uses package spec strings (e.g., '@scope/pkg@1.0.0', 'prettier@3.0.0')
 * - Caller provides complete spec string with version for accurate cache keying
 * - For package installs: Use PURL-style spec with version
 *   Examples: 'npm:prettier@3.0.0', 'pypi:requests@2.31.0', 'gem:rails@7.0.0'
 *   Note: Socket uses shorthand format without 'pkg:' prefix
 *   (handled by @socketregistry/packageurl-js)
 * - For binary downloads: Use URL:name for uniqueness
 *
 * Reference: npm/cli v11.6.2 libnpmexec/lib/index.js#L233-L244
 * https://github.com/npm/cli/blob/v11.6.2/workspaces/libnpmexec/lib/index.js#L233-L244
 * Implementation: packages.map().sort().join('\n') → SHA-512 → slice(0,16)
 * npx hashes the package spec (name@version), not just name
 */
export function generateCacheKey(spec: string): string {
  return createHash('sha512').update(spec).digest('hex').substring(0, 16)
}

let _path: typeof import('path') | undefined
/**
 * Lazily load the path module to avoid Webpack errors.
 * @private
 */
/*@__NO_SIDE_EFFECTS__*/
function getPath() {
  if (_path === undefined) {
    // Use non-'node:' prefixed require to avoid Webpack errors.

    _path = /*@__PURE__*/ require('node:path')
  }
  return _path!
}

/**
 * Clear all DLX package installations.
 */
export async function clearDlx(): Promise<void> {
  const packages = await listDlxPackagesAsync()
  await pEach(packages, pkg => removeDlxPackage(pkg))
}

/**
 * Clear all DLX package installations synchronously.
 */
export function clearDlxSync(): void {
  const packages = listDlxPackages()
  for (const pkg of packages) {
    removeDlxPackageSync(pkg)
  }
}

/**
 * Check if the DLX directory exists.
 */
export function dlxDirExists(): boolean {
  const fs = getFs()
  return fs.existsSync(getSocketDlxDir())
}

/**
 * Check if the DLX directory exists asynchronously.
 */
export async function dlxDirExistsAsync(): Promise<boolean> {
  const fs = getFs()
  try {
    await fs.promises.access(getSocketDlxDir())
    return true
  } catch {
    return false
  }
}

/**
 * Ensure the DLX directory exists, creating it if necessary.
 */
export async function ensureDlxDir(): Promise<void> {
  await safeMkdir(getSocketDlxDir())
}

/**
 * Ensure the DLX directory exists synchronously, creating it if necessary.
 */
export function ensureDlxDirSync(): void {
  safeMkdirSync(getSocketDlxDir())
}

/**
 * Get the installed package directory within DLX node_modules.
 */
export function getDlxInstalledPackageDir(packageName: string): string {
  const path = getPath()
  return normalizePath(
    path.join(getDlxPackageNodeModulesDir(packageName), packageName),
  )
}

/**
 * Get the DLX installation directory for a specific package.
 */
export function getDlxPackageDir(packageName: string): string {
  const path = getPath()
  return normalizePath(path.join(getSocketDlxDir(), packageName))
}

/**
 * Get the package.json path for a DLX installed package.
 */
export function getDlxPackageJsonPath(packageName: string): string {
  const path = getPath()
  return normalizePath(
    path.join(getDlxInstalledPackageDir(packageName), 'package.json'),
  )
}

/**
 * Get the node_modules directory for a DLX package installation.
 */
export function getDlxPackageNodeModulesDir(packageName: string): string {
  const path = getPath()
  return normalizePath(path.join(getDlxPackageDir(packageName), 'node_modules'))
}

/**
 * Check if a file path is within the Socket DLX directory.
 * This is useful for determining if a binary or file is managed by Socket's DLX system.
 *
 * @param filePath - Absolute or relative path to check
 * @returns true if the path is within ~/.socket/_dlx/, false otherwise
 *
 * @example
 * ```typescript
 * isInSocketDlx('/home/user/.socket/_dlx/abc123/bin/socket') // true
 * isInSocketDlx('/usr/local/bin/socket') // false
 * isInSocketDlx(process.argv[0]) // Check if current binary is in DLX
 * ```
 */
export function isInSocketDlx(filePath: string): boolean {
  if (!filePath) {
    return false
  }

  const path = getPath()
  const dlxDir = getSocketDlxDir()
  const absolutePath = normalizePath(path.resolve(filePath))

  // Check if the absolute path starts with the DLX directory.
  // Both paths are normalized to use forward slashes for consistent comparison.
  return absolutePath.startsWith(`${dlxDir}/`)
}

/**
 * Check if a package is installed in DLX.
 */
export function isDlxPackageInstalled(packageName: string): boolean {
  const fs = getFs()
  return fs.existsSync(getDlxInstalledPackageDir(packageName))
}

/**
 * Check if a package is installed in DLX asynchronously.
 */
export async function isDlxPackageInstalledAsync(
  packageName: string,
): Promise<boolean> {
  const fs = getFs()
  try {
    await fs.promises.access(getDlxInstalledPackageDir(packageName))
    return true
  } catch {
    return false
  }
}

/**
 * List all packages installed in DLX.
 */
export function listDlxPackages(): string[] {
  try {
    return readDirNamesSync(getSocketDlxDir(), { sort: true })
  } catch {
    return []
  }
}

/**
 * List all packages installed in DLX asynchronously.
 */
export async function listDlxPackagesAsync(): Promise<string[]> {
  const fs = getFs()
  try {
    const entries = await fs.promises.readdir(getSocketDlxDir(), {
      withFileTypes: true,
    })
    return entries
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort()
  } catch {
    return []
  }
}

/**
 * Remove a DLX package installation.
 */
export async function removeDlxPackage(packageName: string): Promise<void> {
  const packageDir = getDlxPackageDir(packageName)
  try {
    await safeDelete(packageDir, { recursive: true, force: true })
  } catch (e) {
    throw new Error(`Failed to remove DLX package "${packageName}"`, {
      cause: e,
    })
  }
}

/**
 * Remove a DLX package installation synchronously.
 */
export function removeDlxPackageSync(packageName: string): void {
  const fs = getFs()
  const packageDir = getDlxPackageDir(packageName)
  try {
    fs.rmSync(packageDir, { recursive: true, force: true })
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'EACCES' || code === 'EPERM') {
      throw new Error(
        `Permission denied removing DLX package "${packageName}"\n` +
          `Directory: ${packageDir}\n` +
          'To resolve:\n' +
          '  1. Check file/directory permissions\n' +
          '  2. Close any programs using files in this directory\n' +
          '  3. Try running with elevated privileges if necessary\n' +
          `  4. Manually remove: rm -rf "${packageDir}"`,
        { cause: e },
      )
    }
    if (code === 'EROFS') {
      throw new Error(
        `Cannot remove DLX package "${packageName}" from read-only filesystem\n` +
          `Directory: ${packageDir}\n` +
          'The filesystem is mounted read-only.',
        { cause: e },
      )
    }
    throw new Error(
      `Failed to remove DLX package "${packageName}"\n` +
        `Directory: ${packageDir}\n` +
        'Check permissions and ensure no programs are using this directory.',
      { cause: e },
    )
  }
}
