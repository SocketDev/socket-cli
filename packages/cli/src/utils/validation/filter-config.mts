/**
 * Filter configuration utilities for Socket CLI.
 * Manages filter configuration normalization for security scanning.
 *
 * Key Functions:
 * - toFilterConfig: Normalize filter configuration objects
 *
 * Usage:
 * - Normalizes user-provided filter objects
 * - Ensures proper structure for filter configuration
 * - Validates boolean and array values
 */

import { isObject } from '@socketsecurity/lib/objects'

export type FilterConfig = {
  [key: string]: boolean | string[]
}

export function toFilterConfig(obj: unknown): FilterConfig {
  const normalized = Object.create(null) as FilterConfig
  const keys = isObject(obj) ? Object.keys(obj) : []
  for (let i = 0, { length } = keys; i < length; i += 1) {
    const key = keys[i]
    const value = (obj as Record<string, unknown>)[key]
    if (typeof value === 'boolean' || Array.isArray(value)) {
      normalized[key] = value
    }
  }
  return normalized
}
