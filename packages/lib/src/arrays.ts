/**
 * @fileoverview Array utility functions for formatting lists and collections.
 * Provides conjunction and disjunction formatters using Intl.ListFormat.
 */

let _conjunctionFormatter: Intl.ListFormat | undefined
/**
 * Get a cached Intl.ListFormat instance for conjunction (and) formatting.
 *
 * Creates a singleton formatter for English "and" lists using the long style.
 * The formatter is lazily initialized on first use and reused for performance.
 *
 * @returns Cached Intl.ListFormat instance configured for conjunction formatting
 *
 * @example
 * ```ts
 * const formatter = getConjunctionFormatter()
 * formatter.format(['apple', 'banana', 'cherry'])
 * // Returns: "apple, banana, and cherry"
 * ```
 *
 * @private
 */
/*@__NO_SIDE_EFFECTS__*/
function getConjunctionFormatter() {
  if (_conjunctionFormatter === undefined) {
    _conjunctionFormatter = new Intl.ListFormat('en', {
      style: 'long',
      // "and" lists.
      type: 'conjunction',
    })
  }
  return _conjunctionFormatter
}

let _disjunctionFormatter: Intl.ListFormat | undefined
/**
 * Get a cached Intl.ListFormat instance for disjunction (or) formatting.
 *
 * Creates a singleton formatter for English "or" lists using the long style.
 * The formatter is lazily initialized on first use and reused for performance.
 *
 * @returns Cached Intl.ListFormat instance configured for disjunction formatting
 *
 * @example
 * ```ts
 * const formatter = getDisjunctionFormatter()
 * formatter.format(['red', 'blue', 'green'])
 * // Returns: "red, blue, or green"
 * ```
 *
 * @private
 */
/*@__NO_SIDE_EFFECTS__*/
function getDisjunctionFormatter() {
  if (_disjunctionFormatter === undefined) {
    _disjunctionFormatter = new Intl.ListFormat('en', {
      style: 'long',
      // "or" lists.
      type: 'disjunction',
    })
  }
  return _disjunctionFormatter
}

/**
 * Split an array into chunks of a specified size.
 *
 * Divides an array into smaller arrays of the specified chunk size.
 * The last chunk may contain fewer elements if the array length is not
 * evenly divisible by the chunk size.
 *
 * @param arr - The array to split into chunks (can be readonly)
 * @param size - Size of each chunk. Must be greater than 0.
 * @default 2
 * @returns Array of chunks, where each chunk is an array of elements
 * @throws {Error} If chunk size is less than or equal to 0
 *
 * @example
 * ```ts
 * // Split into pairs (default)
 * arrayChunk([1, 2, 3, 4, 5])
 * // Returns: [[1, 2], [3, 4], [5]]
 *
 * // Split into groups of 3
 * arrayChunk(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 3)
 * // Returns: [['a', 'b', 'c'], ['d', 'e', 'f'], ['g']]
 *
 * // Works with readonly arrays
 * const readonlyArr = [1, 2, 3] as const
 * arrayChunk(readonlyArr)
 * // Returns: [[1, 2], [3]]
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function arrayChunk<T>(
  arr: T[] | readonly T[],
  size?: number | undefined,
): T[][] {
  const chunkSize = size ?? 2
  if (chunkSize <= 0) {
    throw new Error('Chunk size must be greater than 0')
  }
  const { length } = arr
  const actualChunkSize = Math.min(length, chunkSize)
  const chunks = []
  for (let i = 0; i < length; i += actualChunkSize) {
    chunks.push(arr.slice(i, i + actualChunkSize) as T[])
  }
  return chunks
}

/**
 * Get unique values from an array.
 *
 * Returns a new array containing only the unique values from the input array.
 * Uses `Set` internally for efficient deduplication. Order of first occurrence
 * is preserved.
 *
 * @param arr - The array to deduplicate (can be readonly)
 * @returns New array with duplicate values removed
 *
 * @example
 * ```ts
 * // Remove duplicate numbers
 * arrayUnique([1, 2, 2, 3, 1, 4])
 * // Returns: [1, 2, 3, 4]
 *
 * // Remove duplicate strings
 * arrayUnique(['apple', 'banana', 'apple', 'cherry'])
 * // Returns: ['apple', 'banana', 'cherry']
 *
 * // Works with readonly arrays
 * const readonlyArr = [1, 1, 2] as const
 * arrayUnique(readonlyArr)
 * // Returns: [1, 2]
 *
 * // Empty arrays return empty
 * arrayUnique([])
 * // Returns: []
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function arrayUnique<T>(arr: T[] | readonly T[]): T[] {
  return [...new Set(arr)]
}

// IMPORTANT: Do not use destructuring here - use direct assignment instead.
// tsgo has a bug that incorrectly transpiles destructured exports, resulting in
// `exports.SomeName = void 0;` which causes runtime errors.
// See: https://github.com/SocketDev/socket-packageurl-js/issues/3

/**
 * Alias for native Array.isArray.
 * Determines whether the passed value is an array.
 *
 * This is a direct reference to the native `Array.isArray` method,
 * providing a type guard that narrows the type to an array type.
 * Exported for consistency with other array utilities in this module.
 *
 * @param value - The value to check
 * @returns `true` if the value is an array, `false` otherwise
 *
 * @example
 * ```ts
 * // Check if value is an array
 * isArray([1, 2, 3])
 * // Returns: true
 *
 * isArray('not an array')
 * // Returns: false
 *
 * isArray(null)
 * // Returns: false
 *
 * // Type guard usage
 * function processValue(value: unknown) {
 *   if (isArray(value)) {
 *     // TypeScript knows value is an array here
 *     console.log(value.length)
 *   }
 * }
 * ```
 */
export const isArray = Array.isArray

/**
 * Join array elements with proper "and" conjunction formatting.
 *
 * Formats an array of strings into a grammatically correct list using
 * "and" as the conjunction. Uses `Intl.ListFormat` for proper English
 * formatting with Oxford comma support.
 *
 * @param arr - Array of strings to join (can be readonly)
 * @returns Formatted string with proper "and" conjunction
 *
 * @example
 * ```ts
 * // Two items
 * joinAnd(['apples', 'oranges'])
 * // Returns: "apples and oranges"
 *
 * // Three or more items (Oxford comma)
 * joinAnd(['apples', 'oranges', 'bananas'])
 * // Returns: "apples, oranges, and bananas"
 *
 * // Single item
 * joinAnd(['apples'])
 * // Returns: "apples"
 *
 * // Empty array
 * joinAnd([])
 * // Returns: ""
 *
 * // Usage in messages
 * const items = ['React', 'Vue', 'Angular']
 * console.log(`You can choose ${joinAnd(items)}`)
 * // Outputs: "You can choose React, Vue, and Angular"
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function joinAnd(arr: string[] | readonly string[]): string {
  return getConjunctionFormatter().format(arr)
}

/**
 * Join array elements with proper "or" disjunction formatting.
 *
 * Formats an array of strings into a grammatically correct list using
 * "or" as the disjunction. Uses `Intl.ListFormat` for proper English
 * formatting with Oxford comma support.
 *
 * @param arr - Array of strings to join (can be readonly)
 * @returns Formatted string with proper "or" disjunction
 *
 * @example
 * ```ts
 * // Two items
 * joinOr(['yes', 'no'])
 * // Returns: "yes or no"
 *
 * // Three or more items (Oxford comma)
 * joinOr(['red', 'green', 'blue'])
 * // Returns: "red, green, or blue"
 *
 * // Single item
 * joinOr(['maybe'])
 * // Returns: "maybe"
 *
 * // Empty array
 * joinOr([])
 * // Returns: ""
 *
 * // Usage in prompts
 * const options = ['npm', 'yarn', 'pnpm']
 * console.log(`Choose a package manager: ${joinOr(options)}`)
 * // Outputs: "Choose a package manager: npm, yarn, or pnpm"
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function joinOr(arr: string[] | readonly string[]): string {
  return getDisjunctionFormatter().format(arr)
}
