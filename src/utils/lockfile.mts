/** @fileoverview Lockfile reading utilities for package managers. */

import { existsSync } from 'node:fs'

import { readFileUtf8 } from '@socketsecurity/registry/lib/fs'

/**
 * Reads a lockfile (package-lock.json, yarn.lock, or pnpm-lock.yaml) from the specified path.
 * @param lockfilePath - The path to the lockfile to read.
 * @returns The contents of the lockfile as a string, or undefined if the file doesn't exist.
 */
export async function readLockfile(
  lockfilePath: string,
): Promise<string | undefined> {
  if (!existsSync(lockfilePath)) {
    return undefined
  }

  return await readFileUtf8(lockfilePath)
}
