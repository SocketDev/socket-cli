/**
 * @fileoverview Word manipulation utilities for capitalization and formatting.
 * Provides text transformation functions for consistent word processing.
 */

/**
 * Capitalize the first letter of a word.
 */
/*@__NO_SIDE_EFFECTS__*/
export function capitalize(word: string): string {
  const { length } = word
  if (length === 0) {
    return word
  }
  if (length === 1) {
    return word.toUpperCase()
  }
  return `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`
}

/**
 * Determine the appropriate article (a/an) for a word.
 */
/*@__NO_SIDE_EFFECTS__*/
export function determineArticle(word: string): string {
  return /^[aeiou]/.test(word) ? 'an' : 'a'
}

export interface PluralizeOptions {
  count?: number
}

/**
 * Pluralize a word based on count.
 */
/*@__NO_SIDE_EFFECTS__*/
export function pluralize(
  word: string,
  options?: PluralizeOptions | undefined,
): string {
  const { count = 1 } = { __proto__: null, ...options } as PluralizeOptions
  // Handle 0, negatives, decimals, and values > 1 as plural.
  return count === 1 ? word : `${word}s`
}
