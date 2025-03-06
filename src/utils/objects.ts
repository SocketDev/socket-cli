export function pick<T extends Record<string, any>, K extends keyof T>(
  input: T,
  keys: K[] | readonly K[]
): Pick<T, K> {
  const result: Partial<Pick<T, K>> = {}
  for (const key of keys) {
    result[key] = input[key]
  }
  return result as Pick<T, K>
}
