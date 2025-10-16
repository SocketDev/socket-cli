/**
 * @fileoverview Canonical Node.js ESM loader to alias local Socket packages.
 * Used across all socket-* repositories for consistent local development.
 *
 * This file should be copied or imported from socket-registry to other repos.
 *
 * Usage:
 *   node --loader=./scripts/utils/alias-loader.mjs script.mjs
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { getLocalPackageAliases } from './get-local-package-aliases.mjs'

// Infer root directory from this loader's location.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.resolve(__dirname, '..', '..')

// Get aliases from shared utility.
const aliases = getLocalPackageAliases(rootPath)

export function resolve(specifier, context, nextResolve) {
  // Check if specifier starts with an aliased package.
  for (const [pkg, localPath] of Object.entries(aliases)) {
    if (specifier === pkg || specifier.startsWith(`${pkg}/`)) {
      // Replace package name with local path.
      const subpath = specifier === pkg ? '' : specifier.slice(pkg.length)

      // Try multiple resolution strategies.
      const candidates = [
        path.join(localPath, subpath),
        path.join(localPath, `${subpath}.mjs`),
        path.join(localPath, `${subpath}.js`),
        path.join(localPath, 'dist', subpath),
        path.join(localPath, 'dist', `${subpath}.mjs`),
        path.join(localPath, 'dist', `${subpath}.js`),
      ]

      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          return nextResolve(pathToFileURL(candidate).href, context)
        }
      }

      // If nothing found, try the first candidate anyway.
      return nextResolve(pathToFileURL(candidates[0]).href, context)
    }
  }

  // Pass through to default resolver.
  return nextResolve(specifier, context)
}
