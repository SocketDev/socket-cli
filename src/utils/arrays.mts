/**
 * Narrowly copied from `@socketsecurity/registry` 1.1.17 `lib/arrays.js`.
 * Copyright (c) Socket Inc. Licensed under the MIT License.
 */

let conjunctionFormatter: Intl.ListFormat | undefined
let disjunctionFormatter: Intl.ListFormat | undefined

/** Join values with the English conjunction "and". */
export function joinAnd(values: readonly string[]): string {
  conjunctionFormatter ??= new Intl.ListFormat('en', {
    style: 'long',
    type: 'conjunction',
  })
  return conjunctionFormatter.format(values)
}

/** Return an array containing each value once, preserving its first occurrence. */
export function arrayUnique<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

/** Join values with the English disjunction "or". */
export function joinOr(values: readonly string[]): string {
  disjunctionFormatter ??= new Intl.ListFormat('en', {
    style: 'long',
    type: 'disjunction',
  })
  return disjunctionFormatter.format(values)
}
