/**
 * @fileoverview Sorting comparison functions including locale-aware and natural sorting.
 * Provides various comparison utilities for arrays and collections.
 */

let _localeCompare: ((x: string, y: string) => number) | undefined
/**
 * Compare two strings using locale-aware comparison.
 */
/*@__NO_SIDE_EFFECTS__*/
export function localeCompare(x: string, y: string): number {
  if (_localeCompare === undefined) {
    // Lazily call new Intl.Collator() because in Node it can take 10-14ms.
    _localeCompare = new Intl.Collator().compare
  }
  return _localeCompare(x, y)
}

let _naturalCompare: ((x: string, y: string) => number) | undefined
/**
 * Compare two strings using natural sorting (numeric-aware, case-insensitive).
 */
/*@__NO_SIDE_EFFECTS__*/
export function naturalCompare(x: string, y: string): number {
  if (_naturalCompare === undefined) {
    // Lazily call new Intl.Collator() because in Node it can take 10-14ms.
    _naturalCompare = new Intl.Collator(
      // The `undefined` locale means it uses the default locale of the user's
      // environment.
      undefined,
      {
        // Enables numeric sorting: numbers in strings are compared by value,
        // e.g. 'file2' comes before 'file10' as numbers and not 'file10' before
        // 'file2' as plain text.
        numeric: true,
        // Makes the comparison case-insensitive and ignores diacritics, e.g.
        // 'a', 'A', and 'á' are treated as equivalent.
        sensitivity: 'base',
      },
    ).compare
  }
  return _naturalCompare(x, y)
}

// Type for fast-sort sorter function.
type FastSortFunction = ReturnType<
  typeof import('fast-sort').createNewSortInstance
>

let _naturalSorter: FastSortFunction | undefined
/**
 * Sort an array using natural comparison.
 */
/*@__NO_SIDE_EFFECTS__*/
export function naturalSorter<T>(
  arrayToSort: T[],
): ReturnType<FastSortFunction> {
  if (_naturalSorter === undefined) {
    const fastSort =
      /*@__PURE__*/ require('fast-sort') as typeof import('fast-sort')
    _naturalSorter = fastSort.createNewSortInstance({
      comparer: naturalCompare,
    }) as FastSortFunction
  }
  return (_naturalSorter as FastSortFunction)(arrayToSort)
}

/**
 * Simple string comparison.
 */
/*@__NO_SIDE_EFFECTS__*/
export function compareStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Compare semantic versions.
 */
/*@__NO_SIDE_EFFECTS__*/
export function compareSemver(a: string, b: string): number {
  const semver =
    /*@__PURE__*/ require('semver') as typeof import('semver')
  const validA: string | null = semver.valid(a)
  const validB: string | null = semver.valid(b)

  if (!validA && !validB) {
    return 0
  }
  if (!validA) {
    return -1
  }
  if (!validB) {
    return 1
  }
  return semver.compare(a, b) as number
}
