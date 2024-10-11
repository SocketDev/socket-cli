export function getOwn(obj: any, propKey: PropertyKey): any {
  if (obj === null || obj === undefined) return undefined
  return Object.hasOwn(obj, propKey) ? obj[propKey] : undefined
}

export function hasOwn(obj: any, propKey: PropertyKey): boolean {
  if (obj === null || obj === undefined) return false
  return Object.hasOwn(obj, propKey)
}

export function isObjectObject(value: any): value is { [key: string]: any } {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

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
