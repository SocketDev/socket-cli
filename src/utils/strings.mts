/**
 * String manipulation utilities for Socket CLI.
 * Provides common string transformations and formatting.
 *
 * Key Functions:
 * - camelToKebab: Convert camelCase to kebab-case
 *
 * Usage:
 * - Command name transformations
 * - Flag name conversions
 * - Consistent string formatting
 */

export function camelToKebab(str: string): string {
  return str === '' ? '' : str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}
