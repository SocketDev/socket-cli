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

import { isObject } from '@socketsecurity/registry/lib/objects'

export type FilterConfig = {
  [key: string]: boolean | string[]
}

export function toFilterConfig(obj: unknown): FilterConfig {
  const normalized = { __proto__: null } as FilterConfig
  if (!isObject(obj)) {
    return normalized
  }
  const record = obj as Record<string, unknown>
  for (const key of Object.keys(record)) {
    const value = record[key]
    if (typeof value === 'boolean' || Array.isArray(value)) {
      normalized[key] = value
    }
  }
  return normalized
}
