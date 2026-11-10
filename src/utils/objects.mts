// Adapted from @socketsecurity/registry 1.1.17, lib/objects.js.
import { isObjectObject } from './is-object-object.mjs'
const { fromEntries: ObjectFromEntries, hasOwn: ObjectHasOwn } = Object
const { ownKeys: ReflectOwnKeys } = Reflect

export type Remap<T> = { [K in keyof T]: T[K] } extends infer O
  ? { [K in keyof O]: O[K] }
  : never

let _localeCompare: ((a: string, b: string) => number) | undefined

function entryKeyComparator(
  a: [string | symbol, any],
  b: [string | symbol, any],
): number {
  if (_localeCompare === undefined) {
    _localeCompare = new Intl.Collator().compare
  }
  const keyA = a[0]
  const keyB = b[0]
  const strKeyA = typeof keyA === 'string' ? keyA : String(keyA)
  const strKeyB = typeof keyB === 'string' ? keyB : String(keyB)
  return _localeCompare(strKeyA, strKeyB)
}

export function getOwn(obj: any, propKey: string | symbol): any {
  if (obj === null || obj === undefined) {
    return undefined
  }
  return ObjectHasOwn(obj, propKey) ? obj[propKey] : undefined
}

export function hasKeys(obj: any): boolean {
  if (obj === null || obj === undefined) {
    return false
  }
  for (const key in obj) {
    if (ObjectHasOwn(obj, key)) {
      return true
    }
  }
  return false
}

export function hasOwn(obj: any, propKey: string | symbol): boolean {
  return obj !== null && obj !== undefined && ObjectHasOwn(obj, propKey)
}

export function isObject(value: any): value is object {
  return value !== null && typeof value === 'object'
}

export { isObjectObject }

export function toSortedObject<T extends Record<string, any>>(
  obj: T,
): Record<PropertyKey, T[keyof T]> {
  const stringEntries: Array<[string | symbol, any]> = []
  const symbolEntries: Array<[string | symbol, any]> = []
  for (const key of ReflectOwnKeys(obj)) {
    const entry = [key, obj[key as keyof T]] as [string | symbol, any]
    if (typeof key === 'symbol') {
      symbolEntries.push(entry)
    } else {
      stringEntries.push(entry)
    }
  }
  if (!stringEntries.length && !symbolEntries.length) {
    return [] as unknown as Record<PropertyKey, T[keyof T]>
  }
  return ObjectFromEntries([
    ...symbolEntries.sort(entryKeyComparator),
    ...stringEntries.sort(entryKeyComparator),
  ]) as Record<PropertyKey, T[keyof T]>
}

export function createEnum<const T extends Record<string, any>>(
  obj: T,
): Readonly<T> {
  return Object.freeze({ __proto__: null, ...obj }) as any
}

export function pick<T extends Record<string, any>, K extends keyof T>(
  input: T,
  keys: K[] | readonly K[],
): Pick<T, K> {
  const result: Partial<Pick<T, K>> = {}
  for (const key of keys) {
    result[key] = input[key]
  }
  return result as Pick<T, K>
}
