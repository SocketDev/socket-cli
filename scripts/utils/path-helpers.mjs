/** @fileoverview Path utility helpers for script operations. */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Get directory name from import.meta.url.
 */
export function getDirname(importMetaUrl) {
  return path.dirname(fileURLToPath(importMetaUrl))
}

/**
 * Get root directory path from current script location.
 */
export function getRootPath(importMetaUrl) {
  return path.join(getDirname(importMetaUrl), '..')
}
