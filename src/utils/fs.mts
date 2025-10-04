/**
 * File system utilities for Socket CLI.
 * Provides file and directory search and deletion functionality.
 *
 * Key Functions:
 * - findUp: Search for files/directories up the directory tree
 * - trash: Safely delete files/directories using registry's remove()
 *
 * Features:
 * - Upward directory traversal
 * - Supports file and directory searching
 * - Abort signal support for cancellation
 * - Multiple name search support
 * - Safe deletion with protection against removing cwd and above
 *
 * Usage:
 * - Finding configuration files (package.json, lockfiles)
 * - Locating project root directories
 * - Searching for specific files in parent directories
 * - Safely deleting files and directories
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import { remove } from '@socketsecurity/registry/lib/fs'

import constants from '../constants.mts'

import type { RemoveOptions } from '@socketsecurity/registry/lib/fs'

export type FindUpOptions = {
  cwd?: string | undefined
  onlyDirectories?: boolean | undefined
  onlyFiles?: boolean | undefined
  signal?: AbortSignal | undefined
}

export async function findUp(
  name: string | string[],
  options?: FindUpOptions | undefined,
): Promise<string | undefined> {
  const opts = { __proto__: null, ...options }
  const { cwd = process.cwd(), signal = constants.abortSignal } = opts
  let { onlyDirectories = false, onlyFiles = true } = opts
  if (onlyDirectories) {
    onlyFiles = false
  }
  if (onlyFiles) {
    onlyDirectories = false
  }
  let dir = path.resolve(cwd)
  const { root } = path.parse(dir)
  const names = [name].flat()
  while (dir && dir !== root) {
    for (const name of names) {
      if (signal?.aborted) {
        return undefined
      }
      const thePath = path.join(dir, name)
      try {
        // eslint-disable-next-line no-await-in-loop
        const stats = await fs.stat(thePath)
        if (!onlyDirectories && stats.isFile()) {
          return thePath
        }
        if (!onlyFiles && stats.isDirectory()) {
          return thePath
        }
      } catch {}
    }
    dir = path.dirname(dir)
  }
  return undefined
}

/**
 * Safely delete files or directories using registry's remove() method.
 * Uses `del` internally for safer deletion that prevents removing cwd and above by default.
 *
 * @param filepath - Path or array of paths to delete
 * @param options - Removal options (force, recursive, retries, etc.)
 * @throws {Error} When attempting to delete protected paths without force option
 *
 * @example
 * // Delete a single file
 * await trash('/path/to/file.txt')
 *
 * @example
 * // Delete a directory recursively
 * await trash('/path/to/dir', { recursive: true })
 *
 * @example
 * // Delete multiple paths
 * await trash(['/path/to/file1.txt', '/path/to/dir'], { recursive: true })
 */
export async function trash(
  filepath: string | string[],
  options?: RemoveOptions | undefined,
): Promise<void> {
  return await remove(filepath, options)
}
