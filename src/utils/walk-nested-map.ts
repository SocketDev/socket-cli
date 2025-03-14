type NestedMap<T> = Map<string, T | NestedMap<T>>

export function* walkNestedMap<T>(
  map: NestedMap<T>,
  keys: string[] = []
): Generator<{ keys: string[]; value: T }> {
  for (const [_key, value] of map.entries()) {
    if (value instanceof Map) {
      yield* walkNestedMap(value as NestedMap<T>, keys.concat(_key))
    } else {
      yield { keys, value: value }
    }
  }
}
