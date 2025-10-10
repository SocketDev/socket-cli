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

// Added for testing
export function kebabToCamel(str: string): string {
  return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
}

// Added for testing
export function pluralize(
  word: string,
  count: number,
  plural?: string | undefined,
): string {
  if (count === 1) {
    return word
  }
  return plural || word + 's'
}
