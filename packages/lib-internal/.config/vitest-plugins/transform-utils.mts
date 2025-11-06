/** @fileoverview Shared utilities for Vitest transform plugins. */

import { dirname, resolve } from 'node:path'

const LIB_MARKER = '/registry/src/lib/'

interface LibPathInfo {
  projectRoot: string
  relativeToLib: string
}

/**
 * Extract project root and relative path from a source file path.
 */
export function extractLibPath(filePath: string): LibPathInfo | null {
  const libIndex = filePath.indexOf(LIB_MARKER)
  if (libIndex === -1) {
    return null
  }

  return {
    projectRoot: filePath.substring(0, libIndex),
    relativeToLib: filePath.substring(libIndex + LIB_MARKER.length),
  }
}

/**
 * Convert TypeScript source path to compiled JavaScript dist path.
 */
export function srcToDistPath(srcPath: string): string | null {
  const extracted = extractLibPath(srcPath)
  if (!extracted) {
    return null
  }

  const { projectRoot, relativeToLib } = extracted
  const relativeJsPath = relativeToLib.replace(/\.ts$/, '.js')

  return resolve(projectRoot, 'registry/dist/lib', relativeJsPath)
}

/**
 * Build absolute dist directory path for a source file.
 */
export function getDistDir(srcFilePath: string): string | null {
  const extracted = extractLibPath(srcFilePath)
  if (!extracted) {
    return null
  }

  const { projectRoot, relativeToLib } = extracted

  return resolve(projectRoot, 'registry/dist/lib', dirname(relativeToLib))
}
