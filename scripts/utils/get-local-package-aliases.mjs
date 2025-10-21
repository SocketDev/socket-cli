/**
 * @fileoverview Canonical helper for resolving local Socket package aliases.
 * Used across all socket-* repositories for consistent local development.
 *
 * This file should be copied or imported from socket-registry to other repos.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * Get aliases for local Socket packages when available.
 * Falls back to published versions in CI or when packages don't exist.
 *
 * @param {string} [rootDir] - The root directory of the current project. Defaults to inferring from caller location.
 * @returns {Record<string, string>} Package aliases mapping (to dist folders for build tools).
 */
export function getLocalPackageAliases(rootDir) {
  const aliases = {}

  // If no rootDir provided, try to infer from stack trace or use process.cwd().
  const baseDir = rootDir || process.cwd()

  // Check for ../socket-lib/dist for @socketsecurity/lib.
  const libPath = path.join(baseDir, '..', 'socket-lib', 'dist')
  if (existsSync(path.join(libPath, '../package.json'))) {
    aliases['@socketsecurity/lib'] = libPath
  }

  // Check for ../socket-packageurl-js/dist.
  const packageurlPath = path.join(
    baseDir,
    '..',
    'socket-packageurl-js',
    'dist',
  )
  if (existsSync(path.join(packageurlPath, '../package.json'))) {
    aliases['@socketregistry/packageurl-js'] = packageurlPath
  }

  // Check for ../socket-registry/registry/dist for @socketsecurity/registry.
  const registryPath = path.join(
    baseDir,
    '..',
    'socket-registry',
    'registry',
    'dist',
  )
  if (existsSync(path.join(registryPath, '../package.json'))) {
    aliases['@socketsecurity/registry'] = registryPath
  }

  // Check for ../socket-sdk-js/dist.
  const sdkPath = path.join(baseDir, '..', 'socket-sdk-js', 'dist')
  if (existsSync(path.join(sdkPath, '../package.json'))) {
    aliases['@socketsecurity/sdk'] = sdkPath
  }

  return aliases
}
