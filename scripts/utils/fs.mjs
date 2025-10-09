/**
 * @fileoverview File system utilities for safe operations.
 * Provides recoverable file deletion using the trash package.
 *
 * Note: This module stays in scripts/utils because the trash package
 * has binary dependencies that shouldn't be included in the distributed library.
 */

import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

/**
 * Find a file or directory by walking up parent directories
 * @param {string|string[]} name - File/directory name(s) to search for
 * @param {Object} options - Options
 * @returns {string|undefined} Path to found file/directory
 */
export function findUpSync(name, options = {}) {
  const {
    cwd = process.cwd(),
    stopAt,
    onlyDirectories = false,
    onlyFiles = true
  } = options

  const names = Array.isArray(name) ? name : [name]
  let currentDir = resolve(cwd)
  const stopDir = stopAt ? resolve(stopAt) : undefined

  while (true) {
    for (const n of names) {
      const fullPath = join(currentDir, n)

      if (existsSync(fullPath)) {
        const stats = statSync(fullPath)

        if (onlyDirectories && stats.isDirectory()) {
          return fullPath
        }

        if (onlyFiles && stats.isFile()) {
          return fullPath
        }

        if (!onlyDirectories && !onlyFiles) {
          return fullPath
        }
      }
    }

    // Check if we've reached the stop directory or root
    if (stopDir && currentDir === stopDir) {
      break
    }

    const parentDir = dirname(currentDir)

    // If we've reached the root directory
    if (parentDir === currentDir) {
      break
    }

    currentDir = parentDir
  }

  return undefined
}