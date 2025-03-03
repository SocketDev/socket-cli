export function objectSome(obj: Record<string, any>): boolean {
  for (const key in obj) {
    if (obj[key]) {
      return true
    }
  }
  return false
}

export function pick<T extends Record<string, any>, K extends keyof T>(
  input: T,
  keys: K[] | ReadonlyArray<K>
): Pick<T, K> {
  const result: Partial<Pick<T, K>> = {}
  for (const key of keys) {
    result[key] = input[key]
  }
  return result as Pick<T, K>
}
