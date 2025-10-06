/** @fileoverview Object manipulation utilities for Socket CLI. */

export function createEnum<
  const T extends Record<string, string | number | boolean>,
>(obj: T): Readonly<T> {
  return Object.freeze({ __proto__: null, ...obj }) as Readonly<T>
}

export function pick<T extends Record<string, unknown>, K extends keyof T>(
  input: T,
  keys: K[] | readonly K[],
): Pick<T, K> {
  const result: Partial<Pick<T, K>> = {}
  for (const key of keys) {
    result[key] = input[key]
  }
  return result as Pick<T, K>
}
