export function createEnum<const T extends Record<string, unknown>>(
  obj: T,
): Readonly<T> {
  return Object.freeze({ __proto__: null, ...obj }) as Readonly<T>
}

export function pick<T extends Record<string, unknown>, K extends keyof T>(
  input: T,
  keys: K[] | readonly K[],
): Pick<T, K> {
  const result: Partial<Pick<T, K>> = {}
  for (let i = 0, { length } = keys; i < length; i += 1) {
    const key = keys[i]!
    result[key] = input[key]
  }
  return result as Pick<T, K>
}
