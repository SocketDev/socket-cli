/** @fileoverview File removal utility using del package. */

import { deleteAsync } from 'del'

/**
 * Remove files or directories using del package.
 * @param {string|string[]} paths - Paths or glob patterns to delete
 * @param {object} options - Options to pass to del
 * @returns {Promise<string[]>} Deleted paths
 */
export async function trash(paths, options = {}) {
  return deleteAsync(paths, {
    force: true,
    ...options
  })
}

// Re-export deleteAsync for direct usage
export { deleteAsync } from 'del'
