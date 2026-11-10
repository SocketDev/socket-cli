/**
 * Narrow copy of @socketsecurity/registry 1.1.17 lib/sorts.js naturalCompare.
 * Copyright (c) Socket Inc. Licensed under the MIT License.
 */

let naturalCompareFn: ((a: string, b: string) => number) | undefined

export function naturalCompare(a: string, b: string): number {
  naturalCompareFn ??= new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
  }).compare
  return naturalCompareFn(a, b)
}
