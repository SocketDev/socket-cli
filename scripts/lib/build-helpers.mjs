/**
 * @fileoverview Helper functions for build script.
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'

/**
 * Get build log path.
 */
export function getBuildLogPath(buildDir) {
  return join(buildDir, 'build.log')
}

/**
 * Save build output to log file.
 */
export async function saveBuildLog(buildDir, content) {
  const logPath = getBuildLogPath(buildDir)
  try {
    await fs.appendFile(logPath, `${content}\n`)
  } catch {
    // Don't fail build if logging fails.
  }
}

/**
 * Format file size in human-readable format.
 */
export function formatBytes(bytes) {
  if (bytes === 0) {
    return '0 B'
  }
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / k ** i).toFixed(2)} ${sizes[i]}`
}
