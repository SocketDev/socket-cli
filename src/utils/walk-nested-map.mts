type NestedMap<T> = Map<string, T | NestedMap<T>>

export function* walkNestedMap<T>(
  map: NestedMap<T>,
  keys: string[] = []
): Generator<{ keys: string[]; value: T }> {
  for (const [key, value] of map.entries()) {
    if (value instanceof Map) {
      yield* walkNestedMap(value as NestedMap<T>, keys.concat(key))
    } else {
      yield { keys: keys.concat(key), value: value }
    }
  }
}
