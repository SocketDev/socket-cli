/*
 * @file Spec-faithful ES polyfills so the compiled hook bundles run on Node ≥18.
 *   The fleet authors hooks in modern `.mts` (Node ≥24), but the bundles are
 *   `.cjs` that must execute on any contributor's Node — down to 18. These
 *   built-ins ship above 18, so a bundle that uses one throws
 *   `TypeError: … is not a function` there. This module installs each ONLY when
 *   absent (feature-detected → no-op on modern Node) and is imported first by
 *   every bundle entry, so the methods exist before any hook runs.
 *
 *   Each implementation follows its ECMA-262 clause; the feature set is mirrored
 *   in .config/fleet/oxlint-plugin/lib/runtime-feature-floors.mts and asserted
 *   equal by the parity test. Verified against native (test/repo/unit/es-polyfills).
 */

type Comparator = (a: unknown, b: unknown) => number

interface TypedArrayInstance {
  readonly length: number
  readonly constructor: new (length: number) => TypedArrayInstance
  [index: number]: number | bigint
  sort(
    comparator?: ((a: never, b: never) => number) | undefined,
  ): TypedArrayInstance
}

// 7.1.5 ToIntegerOrInfinity.
function toIntegerOrInfinity(value: unknown): number {
  const n = Number(value)
  if (Number.isNaN(n) || n === 0) {
    return 0
  }
  if (n === Infinity || n === -Infinity) {
    return n
  }
  return Math.trunc(n)
}

// 7.1.20 ToLength.
function toLength(value: unknown): number {
  const len = toIntegerOrInfinity(value)
  return Math.min(Math.max(len, 0), 2 ** 53 - 1)
}

// 7.3.20 LengthOfArrayLike.
function lengthOfArrayLike(obj: ArrayLike<unknown>): number {
  return toLength(obj.length)
}

// 23.1.3.30.1 CompareArrayElements (undefined always last; NaN comparator → 0).
function compareArrayElements(
  x: unknown,
  y: unknown,
  comparator: Comparator | undefined,
): number {
  const xUndef = x === undefined
  const yUndef = y === undefined
  if (xUndef && yUndef) {
    return 0
  }
  if (xUndef) {
    return 1
  }
  if (yUndef) {
    return -1
  }
  if (comparator !== undefined) {
    const result = Number(comparator(x, y))
    return Number.isNaN(result) ? 0 : result
  }
  const xString = String(x)
  const yString = String(y)
  if (xString < yString) {
    return -1
  }
  if (yString < xString) {
    return 1
  }
  return 0
}

// 23.1.3.34 Array.prototype.toSorted.
export function toSorted(
  this: unknown,
  comparator?: Comparator | undefined,
): unknown[] {
  if (comparator !== undefined && typeof comparator !== 'function') {
    throw new TypeError('The comparator argument must be a function')
  }
  const obj = Object(this) as ArrayLike<unknown>
  const len = lengthOfArrayLike(obj)
  const items: unknown[] = []
  for (let k = 0; k < len; k += 1) {
    items[k] = obj[k]
  }
  items.sort((a, b) => compareArrayElements(a, b, comparator))
  return items
}

// 23.1.3.33 Array.prototype.toReversed.
export function toReversed(this: unknown): unknown[] {
  const obj = Object(this) as ArrayLike<unknown>
  const len = lengthOfArrayLike(obj)
  const out: unknown[] = new Array(len)
  for (let k = 0; k < len; k += 1) {
    out[k] = obj[len - k - 1]
  }
  return out
}

// 23.1.3.35 Array.prototype.toSpliced.
export function toSpliced(
  this: unknown,
  start?: unknown,
  skipCount?: unknown,
  ...items: unknown[]
): unknown[] {
  const argCount = arguments.length
  const obj = Object(this) as ArrayLike<unknown>
  const len = lengthOfArrayLike(obj)
  const relativeStart = toIntegerOrInfinity(start)
  let actualStart: number
  if (relativeStart === -Infinity) {
    actualStart = 0
  } else if (relativeStart < 0) {
    actualStart = Math.max(len + relativeStart, 0)
  } else {
    actualStart = Math.min(relativeStart, len)
  }
  let actualSkipCount: number
  if (argCount === 0) {
    actualSkipCount = 0
  } else if (argCount === 1) {
    actualSkipCount = len - actualStart
  } else {
    const sc = toIntegerOrInfinity(skipCount)
    actualSkipCount = Math.min(Math.max(sc, 0), len - actualStart)
  }
  const newLen = len + items.length - actualSkipCount
  if (newLen > 2 ** 53 - 1) {
    throw new TypeError('Array length exceeded')
  }
  const out: unknown[] = new Array(newLen)
  let writeIndex = 0
  let readIndex = actualStart + actualSkipCount
  while (writeIndex < actualStart) {
    out[writeIndex] = obj[writeIndex]
    writeIndex += 1
  }
  for (const item of items) {
    out[writeIndex] = item
    writeIndex += 1
  }
  while (writeIndex < newLen) {
    out[writeIndex] = obj[readIndex]
    writeIndex += 1
    readIndex += 1
  }
  return out
}

// 23.1.3.39 Array.prototype.with.
export function arrayWith(
  this: unknown,
  index: unknown,
  value: unknown,
): unknown[] {
  const obj = Object(this) as ArrayLike<unknown>
  const len = lengthOfArrayLike(obj)
  const relativeIndex = toIntegerOrInfinity(index)
  const actualIndex = relativeIndex >= 0 ? relativeIndex : len + relativeIndex
  if (actualIndex >= len || actualIndex < 0) {
    throw new RangeError('Invalid index')
  }
  const out: unknown[] = new Array(len)
  for (let k = 0; k < len; k += 1) {
    out[k] = k === actualIndex ? value : obj[k]
  }
  return out
}

// 23.1.3.12 Array.prototype.findLast.
export function findLast(
  this: unknown,
  predicate: (
    value: unknown,
    index: number,
    obj: ArrayLike<unknown>,
  ) => unknown,
  thisArg?: unknown,
): unknown {
  if (typeof predicate !== 'function') {
    throw new TypeError('predicate must be a function')
  }
  const obj = Object(this) as ArrayLike<unknown>
  const len = lengthOfArrayLike(obj)
  for (let k = len - 1; k >= 0; k -= 1) {
    const value = obj[k]
    if (predicate.call(thisArg, value, k, obj)) {
      return value
    }
  }
  return undefined
}

// 23.1.3.13 Array.prototype.findLastIndex.
export function findLastIndex(
  this: unknown,
  predicate: (
    value: unknown,
    index: number,
    obj: ArrayLike<unknown>,
  ) => unknown,
  thisArg?: unknown,
): number {
  if (typeof predicate !== 'function') {
    throw new TypeError('predicate must be a function')
  }
  const obj = Object(this) as ArrayLike<unknown>
  const len = lengthOfArrayLike(obj)
  for (let k = len - 1; k >= 0; k -= 1) {
    if (predicate.call(thisArg, obj[k], k, obj)) {
      return k
    }
  }
  return -1
}

// 7.4.x GroupBy abstract op (sync iterator; key coercion per mode).
function groupByRecords(
  items: Iterable<unknown>,
  callback: (value: unknown, index: number) => unknown,
  coercion: 'property' | 'collection',
): Map<unknown, unknown[]> {
  if (items === undefined || items === null) {
    throw new TypeError('items is not object-coercible')
  }
  if (typeof callback !== 'function') {
    throw new TypeError('callback must be a function')
  }
  const groups = new Map<unknown, unknown[]>()
  let k = 0
  for (const value of items) {
    if (k >= 2 ** 53 - 1) {
      throw new TypeError('Too many elements')
    }
    let key = callback(value, k)
    if (coercion === 'property') {
      // ToPropertyKey: symbols stay symbols, everything else → String.
      key = typeof key === 'symbol' ? key : String(key)
    } else if (Object.is(key, -0)) {
      // CanonicalizeKeyedCollectionKey: -0 → +0.
      key = 0
    }
    const existing = groups.get(key)
    if (existing) {
      existing.push(value)
    } else {
      groups.set(key, [value])
    }
    k += 1
  }
  return groups
}

// 20.1.2.13 Object.groupBy (result does not inherit from %Object.prototype%).
export function objectGroupBy(
  items: Iterable<unknown>,
  callback: (value: unknown, index: number) => PropertyKey,
): Record<PropertyKey, unknown[]> {
  const groups = groupByRecords(items, callback, 'property')
  const obj = Object.create(null) as Record<PropertyKey, unknown[]>
  for (const [key, elements] of groups) {
    Object.defineProperty(obj, key as PropertyKey, {
      configurable: true,
      enumerable: true,
      value: elements,
      writable: true,
    })
  }
  return obj
}

// 24.1.1.14 Map.groupBy.
export function mapGroupBy(
  items: Iterable<unknown>,
  callback: (value: unknown, index: number) => unknown,
): Map<unknown, unknown[]> {
  const groups = groupByRecords(items, callback, 'collection')
  return new Map(groups)
}

// 27.2.4.8 Promise.withResolvers.
export function withResolvers<T>(): {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, reject, resolve }
}

// 23.1.2.1 Array.fromAsync.
export async function fromAsync(
  this: unknown,
  items: unknown,
  mapper?: ((value: unknown, index: number) => unknown) | undefined,
  thisArg?: unknown,
): Promise<unknown[]> {
  let mapping = false
  if (mapper !== undefined) {
    if (typeof mapper !== 'function') {
      throw new TypeError('mapper must be a function')
    }
    mapping = true
  }
  const source = items as
    | (Record<symbol, unknown> & ArrayLike<unknown>)
    | null
    | undefined
  const asyncMethod = source?.[Symbol.asyncIterator]
  const syncMethod = asyncMethod == null ? source?.[Symbol.iterator] : undefined
  const out: unknown[] = []
  let k = 0
  if (asyncMethod != null) {
    for await (const value of items as AsyncIterable<unknown>) {
      out[k] = mapping ? await mapper!.call(thisArg, value, k) : value
      k += 1
    }
    return out
  }
  if (syncMethod != null) {
    // Sync iterable: the spec wraps it via CreateAsyncFromSyncIterator; awaiting
    // each yielded value matches that behavior.
    for (const raw of items as Iterable<unknown>) {
      const value = await raw
      out[k] = mapping ? await mapper!.call(thisArg, value, k) : value
      k += 1
    }
    return out
  }
  // Array-like fallback.
  const arrayLike = Object(items) as ArrayLike<unknown>
  const len = lengthOfArrayLike(arrayLike)
  const result: unknown[] = new Array(len)
  for (let i = 0; i < len; i += 1) {
    const kValue = await arrayLike[i]
    result[i] = mapping ? await mapper!.call(thisArg, kValue, i) : kValue
  }
  return result
}

// 22.1.3.9 String.prototype.isWellFormed.
export function isWellFormed(this: unknown): boolean {
  const str = String(this)
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < str.length ? str.charCodeAt(i + 1) : 0
      if (next < 0xdc00 || next > 0xdfff) {
        return false
      }
      i += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false
    }
  }
  return true
}

// 22.1.3.29 String.prototype.toWellFormed (lone surrogates → U+FFFD).
export function toWellFormed(this: unknown): string {
  const str = String(this)
  let result = ''
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < str.length ? str.charCodeAt(i + 1) : 0
      if (next < 0xdc00 || next > 0xdfff) {
        result += '�'
      } else {
        result += str[i]! + str[i + 1]!
        i += 1
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      result += '�'
    } else {
      result += str[i]!
    }
  }
  return result
}

function typedArraySameType(
  ta: TypedArrayInstance,
  len: number,
): TypedArrayInstance {
  return new ta.constructor(len)
}

// 23.2.3.32 %TypedArray%.prototype.toReversed.
export function typedArrayToReversed(
  this: TypedArrayInstance,
): TypedArrayInstance {
  const len = this.length
  const out = typedArraySameType(this, len)
  for (let k = 0; k < len; k += 1) {
    out[k] = this[len - k - 1]!
  }
  return out
}

// 23.2.3.33 %TypedArray%.prototype.toSorted (default compare is numeric).
export function typedArrayToSorted(
  this: TypedArrayInstance,
  comparator?: ((a: never, b: never) => number) | undefined,
): TypedArrayInstance {
  if (comparator !== undefined && typeof comparator !== 'function') {
    throw new TypeError('The comparator argument must be a function')
  }
  const len = this.length
  const out = typedArraySameType(this, len)
  for (let k = 0; k < len; k += 1) {
    out[k] = this[k]!
  }
  return comparator === undefined ? out.sort() : out.sort(comparator)
}

// 23.2.3.36 %TypedArray%.prototype.with (value coerced to the element type).
export function typedArrayWith(
  this: TypedArrayInstance,
  index: unknown,
  value: number | bigint,
): TypedArrayInstance {
  const len = this.length
  const relativeIndex = toIntegerOrInfinity(index)
  const actualIndex = relativeIndex >= 0 ? relativeIndex : len + relativeIndex
  if (actualIndex >= len || actualIndex < 0) {
    throw new RangeError('Invalid index')
  }
  const out = typedArraySameType(this, len)
  for (let k = 0; k < len; k += 1) {
    out[k] = this[k]!
  }
  // Element assignment applies ToNumber / ToBigInt coercion (throws on mismatch).
  out[actualIndex] = value
  return out
}

// The feature names this module installs — kept equal to the floors table by the
// parity test (test/repo/unit/es-polyfills/parity.test.mts).
export const POLYFILLED_FEATURES: readonly string[] = [
  'Array.fromAsync',
  'Array.prototype.findLast',
  'Array.prototype.findLastIndex',
  'Array.prototype.toReversed',
  'Array.prototype.toSorted',
  'Array.prototype.toSpliced',
  'Array.prototype.with',
  'Map.groupBy',
  'Object.groupBy',
  'Promise.withResolvers',
  'String.prototype.isWellFormed',
  'String.prototype.toWellFormed',
  'TypedArray.prototype.toReversed',
  'TypedArray.prototype.toSorted',
  'TypedArray.prototype.with',
]

function defineMethod(
  target: object,
  name: string,
  value: (...args: never[]) => unknown,
): void {
  if (typeof (target as Record<string, unknown>)[name] !== 'function') {
    Object.defineProperty(target, name, {
      configurable: true,
      value,
      writable: true,
    })
  }
}

function defineStatic(
  target: object,
  name: string,
  value: (...args: never[]) => unknown,
): void {
  defineMethod(target, name, value)
}

// Install every polyfill that is missing. Idempotent + feature-detected, so it
// is a no-op on Node where the built-ins already exist.
export function installEsPolyfills(): void {
  const arrayProto = Array.prototype as unknown as object
  defineMethod(
    arrayProto,
    'toSorted',
    toSorted as (...args: never[]) => unknown,
  )
  defineMethod(
    arrayProto,
    'toReversed',
    toReversed as (...args: never[]) => unknown,
  )
  defineMethod(
    arrayProto,
    'toSpliced',
    toSpliced as (...args: never[]) => unknown,
  )
  defineMethod(arrayProto, 'with', arrayWith as (...args: never[]) => unknown)
  defineMethod(
    arrayProto,
    'findLast',
    findLast as (...args: never[]) => unknown,
  )
  defineMethod(
    arrayProto,
    'findLastIndex',
    findLastIndex as (...args: never[]) => unknown,
  )

  const stringProto = String.prototype as unknown as object
  defineMethod(
    stringProto,
    'isWellFormed',
    isWellFormed as (...args: never[]) => unknown,
  )
  defineMethod(
    stringProto,
    'toWellFormed',
    toWellFormed as (...args: never[]) => unknown,
  )

  // %TypedArray%.prototype is the prototype of any concrete typed-array prototype.
  const typedArrayProto = Object.getPrototypeOf(
    Int8Array.prototype,
  ) as unknown as object
  defineMethod(
    typedArrayProto,
    'toSorted',
    typedArrayToSorted as (...args: never[]) => unknown,
  )
  defineMethod(
    typedArrayProto,
    'toReversed',
    typedArrayToReversed as (...args: never[]) => unknown,
  )
  defineMethod(
    typedArrayProto,
    'with',
    typedArrayWith as (...args: never[]) => unknown,
  )

  defineStatic(
    Object,
    'groupBy',
    objectGroupBy as (...args: never[]) => unknown,
  )
  defineStatic(Map, 'groupBy', mapGroupBy as (...args: never[]) => unknown)
  defineStatic(
    Promise,
    'withResolvers',
    withResolvers as (...args: never[]) => unknown,
  )
  defineStatic(Array, 'fromAsync', fromAsync as (...args: never[]) => unknown)
}

installEsPolyfills()
