/**
 * @fileoverview Node.js loader to alias @socketsecurity/lib to local socket-lib build when available.
 * This allows scripts to use the latest local version during development.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.resolve(__dirname, '..')

// Check for local socket-lib build
const libPath = path.join(rootPath, '..', 'socket-lib', 'dist')
const useLocalLib = existsSync(libPath)

export function resolve(specifier, context, nextResolve) {
  // Rewrite @socketsecurity/lib imports to local dist if available
  if (useLocalLib && specifier.startsWith('@socketsecurity/lib')) {
    const subpath = specifier.slice('@socketsecurity/lib'.length) || '/index.js'
    // Map @socketsecurity/lib to ../socket-lib/dist/
    const localPath = path.join(
      libPath,
      subpath.startsWith('/') ? subpath.slice(1) : subpath,
    )

    // Add .js extension if not present
    const resolvedPath = localPath.endsWith('.js')
      ? localPath
      : `${localPath}.js`

    // Only use local path if file actually exists
    if (existsSync(resolvedPath)) {
      return {
        url: `file://${resolvedPath}`,
        shortCircuit: true,
      }
    }
  }

  return nextResolve(specifier, context)
}
