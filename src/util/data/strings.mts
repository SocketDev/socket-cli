/**
 * String manipulation utilities for Socket CLI. Provides common string
 * transformations and formatting.
 *
 * Key Functions: - camelToKebab: Convert camelCase to kebab-case.
 *
 * Usage: - Command name transformations - Flag name conversions - Consistent
 * string formatting.
 */

export function camelToKebab(str: string): string {
  // `([a-z])` captures a lowercase letter; `([A-Z])` captures the following uppercase letter — inserts a `-` between them
  return str === '' ? '' : str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}
