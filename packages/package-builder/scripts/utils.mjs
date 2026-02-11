/**
 * Shared utilities for package generator scripts.
 */

import { promises as fs } from 'node:fs'

/**
 * Copy directory recursively.
 *
 * @param {string} src - Source directory path.
 * @param {string} dest - Destination directory path.
 */
export async function copyDirectory(src, dest) {
  await fs.cp(src, dest, { recursive: true })
}
