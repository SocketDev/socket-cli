export function getOrInsert<K, V>(map: Map<K, V>, key: K, make: () => V): V {
  if (map.has(key)) {
    return map.get(key) as V
  }
  const value = make()
  map.set(key, value)
  return value
}
