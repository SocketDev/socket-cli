/**
 * File system utilities for Socket CLI. Provides file and directory search
 * functionality.
 *
 * Key Functions: - findUp: Search for files/directories up the directory tree.
 *
 * Features: - Upward directory traversal - Supports file and directory
 * searching - Abort signal support for cancellation - Multiple name search
 * support.
 *
 * Usage: - Finding configuration files (package.json, lockfiles) - Locating
 * project root directories - Searching for specific files in parent
 * directories.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import { getAbortSignal } from '@socketsecurity/lib-stable/process/abort'

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
  const abortSignal = getAbortSignal()
  const { cwd = process.cwd(), signal = abortSignal } = opts
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
  // Use do-while to check current directory before continuing up the tree.
  // This ensures root directory is checked when cwd is root.
  do {
    for (let i = 0, { length } = names; i < length; i += 1) {
      const candidateName = names[i]!
      if (signal?.aborted) {
        return undefined
      }
      const thePath = path.join(dir, candidateName)
      if (await matchesFindUpEntry(thePath, { onlyDirectories, onlyFiles })) {
        return thePath
      }
    }
    if (dir === root) {
      break
    }
    dir = path.dirname(dir)
  } while (dir)
  return undefined
}

export async function matchesFindUpEntry(
  candidatePath: string,
  options?:
    | { onlyDirectories?: boolean | undefined; onlyFiles?: boolean | undefined }
    | undefined,
): Promise<boolean> {
  const opts = { __proto__: null, ...options }
  try {
    // oxlint-disable-next-line socket/prefer-exists-sync -- stat type.
    const stats = await fs.stat(candidatePath)
    if (!opts.onlyDirectories && stats.isFile()) {
      return true
    }
    if (!opts.onlyFiles && stats.isDirectory()) {
      return true
    }
  } catch {}
  return false
}
