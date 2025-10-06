/** @fileoverview Safe file removal utility with trash fallback. */
import trashPkg from 'trash'

import { remove } from '@socketsecurity/registry/lib/fs'

/**
 * Remove files or directories safely using trash with registry's remove() fallback.
 * First attempts to move items to trash for recoverability. If trash fails
 * (e.g., on CI systems or when trash binary is unavailable), falls back to
 * permanent deletion using registry's remove() method.
 * @throws {Error} Never throws on trash failure; falls back to remove().
 */
export async function trash(paths, options) {
  const pathArray = Array.isArray(paths) ? paths : [paths]
  if (pathArray.length === 0) {
    return
  }

  try {
    await trashPkg(pathArray)
  } catch {
    // If trash fails, fallback to registry's remove().
    await remove(pathArray, {
      force: true,
      recursive: true,
      ...options,
    })
  }
}
