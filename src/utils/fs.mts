/**
 * File system utilities for Socket CLI.
 * Provides file and directory search functionality.
 *
 * Key Functions:
 * - findUp: Search for files/directories up the directory tree
 *
 * Features:
 * - Upward directory traversal
 * - Supports file and directory searching
 * - Abort signal support for cancellation
 * - Multiple name search support
 *
 * Usage:
 * - Finding configuration files (package.json, lockfiles)
 * - Locating project root directories
 * - Searching for specific files in parent directories
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import constants from '../constants.mts'

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
