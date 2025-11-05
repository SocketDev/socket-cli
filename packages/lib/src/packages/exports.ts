/**
 * @fileoverview Package exports field utilities.
 */

import { LOOP_SENTINEL } from '#constants/core'

import { isArray } from '../arrays'
import { isObject, isObjectObject } from '../objects'

/**
 * Find types definition for a specific subpath in package exports.
 */
/*@__NO_SIDE_EFFECTS__*/
export function findTypesForSubpath(
  entryExports: unknown,
  subpath: string,
): string | undefined {
  const queue = [entryExports]
  let pos = 0
  while (pos < queue.length) {
    if (pos === LOOP_SENTINEL) {
      throw new Error(
        'Detected infinite loop in entry exports crawl of getTypesForSubpath',
      )
    }
    const value = queue[pos++]
    if (isArray(value)) {
      for (let i = 0, { length } = value; i < length; i += 1) {
        const item = value[i]
        if (item === subpath) {
          return (value as { types?: string }).types
        }
        if (isObject(item)) {
          queue.push(item)
        }
      }
    } else if (isObject(value)) {
      const keys = Object.getOwnPropertyNames(value)
      for (let i = 0, { length } = keys; i < length; i += 1) {
        const key = keys[i] as string
        const item = value[key]
        if (item === subpath) {
          return (value as { types?: string }).types
        }
        if (isObject(item)) {
          queue.push(item)
        }
      }
    }
  }
  return undefined
}

/**
 * Get subpaths from package exports.
 */
/*@__NO_SIDE_EFFECTS__*/
export function getSubpaths(entryExports: unknown): string[] {
  if (!isObject(entryExports)) {
    return []
  }
  // Return the keys of the exports object (the subpaths).
  return Object.getOwnPropertyNames(entryExports).filter(key =>
    key.startsWith('.'),
  )
}

/**
 * Get file paths from package exports.
 */
/*@__NO_SIDE_EFFECTS__*/
export function getExportFilePaths(entryExports: unknown): string[] {
  if (!isObject(entryExports)) {
    return []
  }

  const paths = []

  // Traverse the exports object to find actual file paths.
  for (const key of Object.getOwnPropertyNames(entryExports)) {
    if (!key.startsWith('.')) {
      continue
    }

    const value = entryExports[key]

    if (typeof value === 'string') {
      // Direct path export.
      paths.push(value)
    } else if (isObject(value)) {
      // Conditional or nested export.
      for (const subKey of Object.getOwnPropertyNames(value)) {
        const subValue = value[subKey]
        if (typeof subValue === 'string') {
          paths.push(subValue)
        } else if (isArray(subValue)) {
          // Array of conditions.
          for (const item of subValue) {
            if (typeof item === 'string') {
              paths.push(item)
            } else if (isObject(item)) {
              // Nested conditional.
              for (const nestedKey of Object.getOwnPropertyNames(item)) {
                const nestedValue = item[nestedKey]
                if (typeof nestedValue === 'string') {
                  paths.push(nestedValue)
                }
              }
            }
          }
        }
      }
    }
  }

  // Remove duplicates and filter out non-file paths.
  return [...new Set(paths)].filter(p => p.startsWith('./'))
}

/**
 * Check if package exports use conditional patterns (e.g., import/require).
 */
/*@__NO_SIDE_EFFECTS__*/
export function isConditionalExports(entryExports: unknown): boolean {
  if (!isObjectObject(entryExports)) {
    return false
  }
  const keys = Object.getOwnPropertyNames(entryExports)
  const { length } = keys
  if (!length) {
    return false
  }
  // Conditional entry exports do NOT contain keys starting with '.'.
  // Entry exports cannot contain some keys starting with '.' and some not.
  // The exports object MUST either be an object of package subpath keys OR
  // an object of main entry condition name keys only.
  for (let i = 0; i < length; i += 1) {
    const key = keys[i] as string
    if (key.length > 0 && key.charCodeAt(0) === 46 /*'.'*/) {
      return false
    }
  }
  return true
}

/**
 * Check if package exports use subpath patterns (keys starting with '.').
 */
/*@__NO_SIDE_EFFECTS__*/
export function isSubpathExports(entryExports: unknown): boolean {
  if (isObjectObject(entryExports)) {
    const keys = Object.getOwnPropertyNames(entryExports)
    for (let i = 0, { length } = keys; i < length; i += 1) {
      // Subpath entry exports contain keys starting with '.'.
      // Entry exports cannot contain some keys starting with '.' and some not.
      // The exports object MUST either be an object of package subpath keys OR
      // an object of main entry condition name keys only.
      if (keys[i]?.charCodeAt(0) === 46 /*'.'*/) {
        return true
      }
    }
  }
  return false
}

/**
 * Normalize package.json exports field to canonical format.
 */
/*@__NO_SIDE_EFFECTS__*/
export function resolvePackageJsonEntryExports(entryExports: unknown): unknown {
  // If conditional exports main sugar
  // https://nodejs.org/api/packages.html#exports-sugar
  if (typeof entryExports === 'string' || isArray(entryExports)) {
    return { '.': entryExports }
  }
  if (isConditionalExports(entryExports)) {
    return entryExports
  }
  return isObject(entryExports) ? entryExports : undefined
}
