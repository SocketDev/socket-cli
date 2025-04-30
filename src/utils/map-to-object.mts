interface NestedRecord<T> {
  [key: string]: T | NestedRecord<T>
}

/**
 * Convert a Map<string, Map|string> to a nested object of similar shape.
 * The goal is to serialize it with JSON.stringify, which Map can't do.
 */
export function mapToObject<T>(
  map: Map<string, T | Map<string, T | Map<string, T>>>
): NestedRecord<T> {
  return Object.fromEntries(
    Array.from(map.entries()).map(([k, v]) => [
      k,
      v instanceof Map ? mapToObject(v) : v
    ])
  )
}
