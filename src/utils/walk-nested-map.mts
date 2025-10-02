/** @fileoverview Nested map traversal utilities. */

type NestedMap<T> = Map<string, T | NestedMap<T>>

export function* walkNestedMap<T>(
  map: NestedMap<T>,
  keys: string[] = [],
): Generator<{ keys: string[]; value: T }> {
  for (const { 0: key, 1: value } of map.entries()) {
    if (value instanceof Map) {
      yield* walkNestedMap(value as NestedMap<T>, [...keys, key])
    } else {
      yield { keys: [...keys, key], value: value }
    }
  }
}
