/**
 * @fileoverview Object manipulation and reflection utilities.
 * Provides type-safe object operations, property access, and structural helpers.
 */

import {
  kInternalsSymbol,
  LOOP_SENTINEL,
  UNDEFINED_TOKEN,
} from '#constants/core'

import { isArray } from './arrays'
import { localeCompare } from './sorts'

// Type definitions

/**
 * Record of property keys mapped to getter functions.
 * Used for defining lazy getters on objects.
 */
type GetterDefObj = { [key: PropertyKey]: () => unknown }

/**
 * Statistics tracking for lazy getter initialization.
 * Keeps track of which lazy getters have been accessed and initialized.
 */
type LazyGetterStats = { initialized?: Set<PropertyKey> | undefined }

/**
 * Configuration options for creating constants objects.
 */
type ConstantsObjectOptions = {
  /**
   * Lazy getter definitions to attach to the object.
   * @default undefined
   */
  getters?: GetterDefObj | undefined
  /**
   * Internal properties to store under `kInternalsSymbol`.
   * @default undefined
   */
  internals?: object | undefined
  /**
   * Properties to mix into the object (lower priority than `props`).
   * @default undefined
   */
  mixin?: object | undefined
}

/**
 * Type helper that creates a remapped type with fresh property mapping.
 * Useful for flattening intersection types into a single object type.
 */
type Remap<T> = { [K in keyof T]: T[K] } extends infer O
  ? { [K in keyof O]: O[K] }
  : never

/**
 * Type for dynamic lazy getter record.
 */
type LazyGetterRecord<T> = {
  [key: PropertyKey]: () => T
}

/**
 * Type for generic property bag.
 */
type PropertyBag = {
  [key: PropertyKey]: unknown
}

/**
 * Type for generic sorted object entries.
 */
type SortedObject<T> = {
  [key: PropertyKey]: T
}

export type { GetterDefObj, LazyGetterStats, ConstantsObjectOptions, Remap }

// IMPORTANT: Do not use destructuring here - use direct assignment instead.
// tsgo has a bug that incorrectly transpiles destructured exports, resulting in
// `exports.SomeName = void 0;` which causes runtime errors.
// See: https://github.com/SocketDev/socket-packageurl-js/issues/3
const ObjectDefineProperties = Object.defineProperties
const ObjectDefineProperty = Object.defineProperty
const ObjectFreeze = Object.freeze
const ObjectFromEntries = Object.fromEntries
const ObjectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors
const ObjectGetOwnPropertyNames = Object.getOwnPropertyNames
const ObjectGetPrototypeOf = Object.getPrototypeOf
const ObjectHasOwn = Object.hasOwn
const ObjectKeys = Object.keys
const ObjectPrototype = Object.prototype
const ObjectSetPrototypeOf = Object.setPrototypeOf
// @ts-expect-error - __defineGetter__ exists but not in type definitions.
// IMPORTANT: Do not use destructuring here - use direct assignment instead.
// tsgo has a bug that incorrectly transpiles destructured exports, resulting in
// `exports.SomeName = void 0;` which causes runtime errors.
// See: https://github.com/SocketDev/socket-packageurl-js/issues/3
const __defineGetter__ = Object.prototype.__defineGetter__
// IMPORTANT: Do not use destructuring here - use direct assignment instead.
// tsgo has a bug that incorrectly transpiles destructured exports, resulting in
// `exports.SomeName = void 0;` which causes runtime errors.
// See: https://github.com/SocketDev/socket-packageurl-js/issues/3
const ReflectOwnKeys = Reflect.ownKeys

/**
 * Create a lazy getter function that memoizes its result.
 *
 * The returned function will only call the getter once, caching the result
 * for subsequent calls. This is useful for expensive computations or
 * operations that should only happen when needed.
 *
 * @param name - The property key name for the getter (used for debugging and stats)
 * @param getter - Function that computes the value on first access
 * @param stats - Optional stats object to track initialization
 * @returns A memoized getter function
 *
 * @example
 * ```ts
 * const stats = { initialized: new Set() }
 * const getLargeData = createLazyGetter('data', () => {
 *   console.log('Computing expensive data...')
 *   return { large: 'dataset' }
 * }, stats)
 *
 * getLargeData() // Logs "Computing expensive data..." and returns data
 * getLargeData() // Returns cached data without logging
 * console.log(stats.initialized.has('data')) // true
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function createLazyGetter<T>(
  name: PropertyKey,
  getter: () => T,
  stats?: LazyGetterStats | undefined,
): () => T {
  let lazyValue: T | typeof UNDEFINED_TOKEN = UNDEFINED_TOKEN
  // Dynamically name the getter without using Object.defineProperty.
  const { [name]: lazyGetter } = {
    [name]() {
      if (lazyValue === UNDEFINED_TOKEN) {
        stats?.initialized?.add(name)
        lazyValue = getter()
      }
      return lazyValue as T
    },
  } as LazyGetterRecord<T>
  return lazyGetter as unknown as () => T
}

/**
 * Create a frozen constants object with lazy getters and internal properties.
 *
 * This function creates an immutable object with:
 * - Regular properties from `props`
 * - Lazy getters that compute values on first access
 * - Internal properties accessible via `kInternalsSymbol`
 * - Mixin properties (lower priority, won't override existing)
 * - Alphabetically sorted keys for consistency
 *
 * The resulting object is deeply frozen and cannot be modified.
 *
 * @param props - Regular properties to include on the object
 * @param options_ - Configuration options
 * @returns A frozen object with all specified properties
 *
 * @example
 * ```ts
 * const config = createConstantsObject(
 *   { apiUrl: 'https://api.example.com' },
 *   {
 *     getters: {
 *       client: () => new APIClient(),
 *       timestamp: () => Date.now()
 *     },
 *     internals: {
 *       version: '1.0.0'
 *     }
 *   }
 * )
 *
 * console.log(config.apiUrl) // 'https://api.example.com'
 * console.log(config.client) // APIClient instance (computed on first access)
 * console.log(config[kInternalsSymbol].version) // '1.0.0'
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function createConstantsObject(
  props: object,
  options_?: ConstantsObjectOptions | undefined,
): Readonly<object> {
  const options = { __proto__: null, ...options_ } as ConstantsObjectOptions
  const attributes = ObjectFreeze({
    __proto__: null,
    getters: options.getters
      ? ObjectFreeze(
          ObjectSetPrototypeOf(toSortedObject(options.getters), null),
        )
      : undefined,
    internals: options.internals
      ? ObjectFreeze(
          ObjectSetPrototypeOf(toSortedObject(options.internals), null),
        )
      : undefined,
    mixin: options.mixin
      ? ObjectFreeze(
          ObjectDefineProperties(
            { __proto__: null },
            ObjectGetOwnPropertyDescriptors(options.mixin),
          ),
        )
      : undefined,
    props: props
      ? ObjectFreeze(ObjectSetPrototypeOf(toSortedObject(props), null))
      : undefined,
  })
  const lazyGetterStats = ObjectFreeze({
    __proto__: null,
    initialized: new Set<PropertyKey>(),
  })
  const object = defineLazyGetters(
    {
      __proto__: null,
      [kInternalsSymbol]: ObjectFreeze({
        __proto__: null,
        get attributes() {
          return attributes
        },
        get lazyGetterStats() {
          return lazyGetterStats
        },
        ...attributes.internals,
      }),
      kInternalsSymbol,
      ...attributes.props,
    },
    attributes.getters,
    lazyGetterStats,
  )
  if (attributes.mixin) {
    ObjectDefineProperties(
      object,
      toSortedObjectFromEntries(
        objectEntries(ObjectGetOwnPropertyDescriptors(attributes.mixin)).filter(
          p => !ObjectHasOwn(object, p[0]),
        ),
      ) as PropertyDescriptorMap,
    )
  }
  return ObjectFreeze(object)
}

/**
 * Define a getter property on an object.
 *
 * The getter is non-enumerable and configurable, meaning it won't show up
 * in `for...in` loops or `Object.keys()`, but can be redefined later.
 *
 * @param object - The object to define the getter on
 * @param propKey - The property key for the getter
 * @param getter - Function that computes the property value
 * @returns The modified object (for chaining)
 *
 * @example
 * ```ts
 * const obj = {}
 * defineGetter(obj, 'timestamp', () => Date.now())
 * console.log(obj.timestamp) // Current timestamp
 * console.log(obj.timestamp) // Different timestamp (computed each time)
 * console.log(Object.keys(obj)) // [] (non-enumerable)
 * ```
 */
export function defineGetter<T>(
  object: object,
  propKey: PropertyKey,
  getter: () => T,
): object {
  ObjectDefineProperty(object, propKey, {
    get: getter,
    enumerable: false,
    configurable: true,
  })
  return object
}

/**
 * Define a lazy getter property on an object.
 *
 * Unlike `defineGetter()`, this version memoizes the result so the getter
 * function is only called once. Subsequent accesses return the cached value.
 *
 * @param object - The object to define the lazy getter on
 * @param propKey - The property key for the lazy getter
 * @param getter - Function that computes the value on first access
 * @param stats - Optional stats object to track initialization
 * @returns The modified object (for chaining)
 *
 * @example
 * ```ts
 * const obj = {}
 * defineLazyGetter(obj, 'data', () => {
 *   console.log('Loading data...')
 *   return { expensive: 'computation' }
 * })
 * console.log(obj.data) // Logs "Loading data..." and returns data
 * console.log(obj.data) // Returns same data without logging
 * ```
 */
export function defineLazyGetter<T>(
  object: object,
  propKey: PropertyKey,
  getter: () => T,
  stats?: LazyGetterStats | undefined,
): object {
  return defineGetter(object, propKey, createLazyGetter(propKey, getter, stats))
}

/**
 * Define multiple lazy getter properties on an object.
 *
 * Each getter in the provided object will be converted to a lazy getter
 * and attached to the target object. All getters share the same stats object
 * for tracking initialization.
 *
 * @param object - The object to define lazy getters on
 * @param getterDefObj - Object mapping property keys to getter functions
 * @param stats - Optional stats object to track initialization
 * @returns The modified object (for chaining)
 *
 * @example
 * ```ts
 * const obj = {}
 * const stats = { initialized: new Set() }
 * defineLazyGetters(obj, {
 *   user: () => fetchUser(),
 *   config: () => loadConfig(),
 *   timestamp: () => Date.now()
 * }, stats)
 *
 * console.log(obj.user) // Fetches user on first access
 * console.log(obj.config) // Loads config on first access
 * console.log(stats.initialized) // Set(['user', 'config'])
 * ```
 */
export function defineLazyGetters(
  object: object,
  getterDefObj: GetterDefObj | undefined,
  stats?: LazyGetterStats | undefined,
): object {
  if (getterDefObj !== null && typeof getterDefObj === 'object') {
    const keys = ReflectOwnKeys(getterDefObj)
    for (let i = 0, { length } = keys; i < length; i += 1) {
      const key = keys[i] as PropertyKey
      defineLazyGetter(object, key, getterDefObj[key] as () => unknown, stats)
    }
  }
  return object
}

/**
 * Compare two entry arrays by their keys for sorting.
 *
 * Used internally for alphabetically sorting object entries.
 * String keys are compared directly, non-string keys are converted to strings first.
 *
 * @param a - First entry tuple [key, value]
 * @param b - Second entry tuple [key, value]
 * @returns Negative if a < b, positive if a > b, zero if equal
 *
 * @example
 * ```ts
 * const entries = [['zebra', 1], ['apple', 2], ['banana', 3]]
 * entries.sort(entryKeyComparator)
 * // [['apple', 2], ['banana', 3], ['zebra', 1]]
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function entryKeyComparator(
  a: [PropertyKey, unknown],
  b: [PropertyKey, unknown],
): number {
  const keyA = a[0]
  const keyB = b[0]
  const strKeyA = typeof keyA === 'string' ? keyA : String(keyA)
  const strKeyB = typeof keyB === 'string' ? keyB : String(keyB)
  return localeCompare(strKeyA, strKeyB)
}

/**
 * Get the enumerable own property keys of an object.
 *
 * This is a safe wrapper around `Object.keys()` that returns an empty array
 * for non-object values instead of throwing an error.
 *
 * @param obj - The value to get keys from
 * @returns Array of enumerable string keys, or empty array for non-objects
 *
 * @example
 * ```ts
 * getKeys({ a: 1, b: 2 }) // ['a', 'b']
 * getKeys([10, 20, 30]) // ['0', '1', '2']
 * getKeys(null) // []
 * getKeys(undefined) // []
 * getKeys('hello') // []
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function getKeys(obj: unknown): string[] {
  return isObject(obj) ? ObjectKeys(obj) : []
}

/**
 * Get an own property value from an object safely.
 *
 * Returns `undefined` if the value is null/undefined or if the property
 * doesn't exist as an own property (not inherited). This avoids prototype
 * chain lookups and prevents errors on null/undefined values.
 *
 * @param obj - The object to get the property from
 * @param propKey - The property key to look up
 * @returns The property value, or `undefined` if not found or obj is null/undefined
 *
 * @example
 * ```ts
 * const obj = { name: 'Alice', age: 30 }
 * getOwn(obj, 'name') // 'Alice'
 * getOwn(obj, 'missing') // undefined
 * getOwn(obj, 'toString') // undefined (inherited, not own property)
 * getOwn(null, 'name') // undefined
 * getOwn(undefined, 'name') // undefined
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function getOwn(obj: unknown, propKey: PropertyKey): unknown {
  if (obj === null || obj === undefined) {
    return undefined
  }
  return ObjectHasOwn(obj as object, propKey)
    ? (obj as Record<PropertyKey, unknown>)[propKey]
    : undefined
}

/**
 * Get all own property values from an object.
 *
 * Returns values for all own properties (enumerable and non-enumerable),
 * but not inherited properties. Returns an empty array for null/undefined.
 *
 * @param obj - The object to get values from
 * @returns Array of all own property values, or empty array for null/undefined
 *
 * @example
 * ```ts
 * getOwnPropertyValues({ a: 1, b: 2, c: 3 }) // [1, 2, 3]
 * getOwnPropertyValues([10, 20, 30]) // [10, 20, 30]
 * getOwnPropertyValues(null) // []
 * getOwnPropertyValues(undefined) // []
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function getOwnPropertyValues<T>(
  obj: { [key: PropertyKey]: T } | null | undefined,
): T[] {
  if (obj === null || obj === undefined) {
    return []
  }
  const keys = ObjectGetOwnPropertyNames(obj)
  const { length } = keys
  const values = Array(length)
  for (let i = 0; i < length; i += 1) {
    values[i] = obj[keys[i] as string]
  }
  return values
}

/**
 * Check if an object has any enumerable own properties.
 *
 * Returns `true` if the object has at least one enumerable own property,
 * `false` otherwise. Also returns `false` for null/undefined.
 *
 * @param obj - The value to check
 * @returns `true` if obj has enumerable own properties, `false` otherwise
 *
 * @example
 * ```ts
 * hasKeys({ a: 1 }) // true
 * hasKeys({}) // false
 * hasKeys([]) // false
 * hasKeys([1, 2]) // true
 * hasKeys(null) // false
 * hasKeys(undefined) // false
 * hasKeys(Object.create({ inherited: true })) // false (inherited, not own)
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function hasKeys(obj: unknown): obj is PropertyBag {
  if (obj === null || obj === undefined) {
    return false
  }
  for (const key in obj as object) {
    if (ObjectHasOwn(obj as object, key)) {
      return true
    }
  }
  return false
}

/**
 * Check if an object has an own property.
 *
 * Type-safe wrapper around `Object.hasOwn()` that returns `false` for
 * null/undefined instead of throwing. Only checks own properties, not
 * inherited ones from the prototype chain.
 *
 * @param obj - The value to check
 * @param propKey - The property key to look for
 * @returns `true` if obj has the property as an own property, `false` otherwise
 *
 * @example
 * ```ts
 * const obj = { name: 'Alice' }
 * hasOwn(obj, 'name') // true
 * hasOwn(obj, 'age') // false
 * hasOwn(obj, 'toString') // false (inherited from Object.prototype)
 * hasOwn(null, 'name') // false
 * hasOwn(undefined, 'name') // false
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function hasOwn(
  obj: unknown,
  propKey: PropertyKey,
): obj is object & PropertyBag {
  if (obj === null || obj === undefined) {
    return false
  }
  return ObjectHasOwn(obj as object, propKey)
}

/**
 * Check if a value is an object (including arrays).
 *
 * Returns `true` for any object type including arrays, functions, dates, etc.
 * Returns `false` for primitives and `null`.
 *
 * @param value - The value to check
 * @returns `true` if value is an object (including arrays), `false` otherwise
 *
 * @example
 * ```ts
 * isObject({}) // true
 * isObject([]) // true
 * isObject(new Date()) // true
 * isObject(() => {}) // false (functions are not objects for typeof)
 * isObject(null) // false
 * isObject(undefined) // false
 * isObject(42) // false
 * isObject('string') // false
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function isObject(
  value: unknown,
): value is { [key: PropertyKey]: unknown } {
  return value !== null && typeof value === 'object'
}

/**
 * Check if a value is a plain object (not an array, not a built-in).
 *
 * Returns `true` only for plain objects created with `{}` or `Object.create(null)`.
 * Returns `false` for arrays, built-in objects (Date, RegExp, etc.), and primitives.
 *
 * @param value - The value to check
 * @returns `true` if value is a plain object, `false` otherwise
 *
 * @example
 * ```ts
 * isObjectObject({}) // true
 * isObjectObject({ a: 1 }) // true
 * isObjectObject(Object.create(null)) // true
 * isObjectObject([]) // false
 * isObjectObject(new Date()) // false
 * isObjectObject(null) // false
 * isObjectObject(42) // false
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function isObjectObject(
  value: unknown,
): value is { [key: PropertyKey]: unknown } {
  if (value === null || typeof value !== 'object' || isArray(value)) {
    return false
  }
  const proto: any = ObjectGetPrototypeOf(value)
  return proto === null || proto === ObjectPrototype
}

// IMPORTANT: Do not use destructuring here - use direct assignment instead.
// tsgo has a bug that incorrectly transpiles destructured exports, resulting in
// `exports.SomeName = void 0;` which causes runtime errors.
// See: https://github.com/SocketDev/socket-packageurl-js/issues/3

/**
 * Alias for native `Object.assign`.
 *
 * Copies all enumerable own properties from one or more source objects
 * to a target object and returns the modified target object.
 *
 * @example
 * ```ts
 * const target = { a: 1 }
 * const source = { b: 2, c: 3 }
 * objectAssign(target, source) // { a: 1, b: 2, c: 3 }
 * ```
 */
export const objectAssign = Object.assign

/**
 * Get all own property entries (key-value pairs) from an object.
 *
 * Unlike `Object.entries()`, this includes non-enumerable properties and
 * symbol keys. Returns an empty array for null/undefined.
 *
 * @param obj - The object to get entries from
 * @returns Array of [key, value] tuples, or empty array for null/undefined
 *
 * @example
 * ```ts
 * objectEntries({ a: 1, b: 2 }) // [['a', 1], ['b', 2]]
 * const sym = Symbol('key')
 * objectEntries({ [sym]: 'value', x: 10 }) // [[Symbol(key), 'value'], ['x', 10]]
 * objectEntries(null) // []
 * objectEntries(undefined) // []
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function objectEntries(obj: unknown): Array<[PropertyKey, unknown]> {
  if (obj === null || obj === undefined) {
    return []
  }
  const keys = ReflectOwnKeys(obj as object)
  const { length } = keys
  const entries = Array(length)
  const record = obj as Record<PropertyKey, unknown>
  for (let i = 0; i < length; i += 1) {
    const key = keys[i] as PropertyKey
    entries[i] = [key, record[key]]
  }
  return entries
}

// IMPORTANT: Do not use destructuring here - use direct assignment instead.
// tsgo has a bug that incorrectly transpiles destructured exports, resulting in
// `exports.SomeName = void 0;` which causes runtime errors.
// See: https://github.com/SocketDev/socket-packageurl-js/issues/3

/**
 * Alias for native `Object.freeze`.
 *
 * Freezes an object, preventing new properties from being added and existing
 * properties from being removed or modified. Makes the object immutable.
 *
 * @example
 * ```ts
 * const obj = { a: 1 }
 * objectFreeze(obj)
 * obj.a = 2 // Silently fails in non-strict mode, throws in strict mode
 * obj.b = 3 // Silently fails in non-strict mode, throws in strict mode
 * ```
 */
export const objectFreeze = Object.freeze

/**
 * Deep merge source object into target object.
 *
 * Recursively merges properties from `source` into `target`. Arrays in source
 * completely replace arrays in target (no element-wise merging). Objects are
 * merged recursively. Includes infinite loop detection for safety.
 *
 * @param target - The object to merge into (will be modified)
 * @param source - The object to merge from
 * @returns The modified target object
 *
 * @example
 * ```ts
 * const target = { a: { x: 1 }, b: [1, 2] }
 * const source = { a: { y: 2 }, b: [3, 4, 5], c: 3 }
 * merge(target, source)
 * // { a: { x: 1, y: 2 }, b: [3, 4, 5], c: 3 }
 * ```
 *
 * @example
 * ```ts
 * // Arrays are replaced, not merged
 * merge({ arr: [1, 2] }, { arr: [3] }) // { arr: [3] }
 *
 * // Deep object merging
 * merge(
 *   { config: { api: 'v1', timeout: 1000 } },
 *   { config: { api: 'v2', retries: 3 } }
 * )
 * // { config: { api: 'v2', timeout: 1000, retries: 3 } }
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function merge<T extends object, U extends object>(
  target: T,
  source: U,
): T & U {
  if (!isObject(target) || !isObject(source)) {
    return target as T & U
  }
  const queue: Array<[unknown, unknown]> = [[target, source]]
  let pos = 0
  let { length: queueLength } = queue
  while (pos < queueLength) {
    if (pos === LOOP_SENTINEL) {
      throw new Error('Detected infinite loop in object crawl of merge')
    }
    const { 0: currentTarget, 1: currentSource } = queue[pos++] as [
      Record<PropertyKey, unknown>,
      Record<PropertyKey, unknown>,
    ]

    if (!currentSource || !currentTarget) {
      continue
    }

    const isSourceArray = isArray(currentSource)
    const isTargetArray = isArray(currentTarget)

    // Skip array merging - arrays in source replace arrays in target
    if (isSourceArray || isTargetArray) {
      continue
    }

    const keys = ReflectOwnKeys(currentSource as object)
    for (let i = 0, { length } = keys; i < length; i += 1) {
      const key = keys[i] as PropertyKey
      const srcVal = currentSource[key]
      const targetVal = currentTarget[key]
      if (isArray(srcVal)) {
        // Replace arrays entirely
        currentTarget[key] = srcVal
      } else if (isObject(srcVal)) {
        if (isObject(targetVal) && !isArray(targetVal)) {
          queue[queueLength++] = [targetVal, srcVal]
        } else {
          currentTarget[key] = srcVal
        }
      } else {
        currentTarget[key] = srcVal
      }
    }
  }
  return target as T & U
}

/**
 * Convert an object to a new object with sorted keys.
 *
 * Creates a new object with the same properties as the input, but with keys
 * sorted alphabetically. Symbol keys are sorted separately and placed first.
 * This is useful for consistent key ordering in serialization or comparisons.
 *
 * @param obj - The object to sort
 * @returns A new object with sorted keys
 *
 * @example
 * ```ts
 * toSortedObject({ z: 1, a: 2, m: 3 })
 * // { a: 2, m: 3, z: 1 }
 *
 * const sym1 = Symbol('first')
 * const sym2 = Symbol('second')
 * toSortedObject({ z: 1, [sym2]: 2, a: 3, [sym1]: 4 })
 * // { [Symbol(first)]: 4, [Symbol(second)]: 2, a: 3, z: 1 }
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function toSortedObject<T extends object>(obj: T): T {
  return toSortedObjectFromEntries(objectEntries(obj)) as T
}

/**
 * Create an object from entries with sorted keys.
 *
 * Takes an iterable of [key, value] entries and creates a new object with
 * keys sorted alphabetically. Symbol keys are sorted separately and placed
 * first in the resulting object.
 *
 * @param entries - Iterable of [key, value] tuples
 * @returns A new object with sorted keys
 *
 * @example
 * ```ts
 * toSortedObjectFromEntries([['z', 1], ['a', 2], ['m', 3]])
 * // { a: 2, m: 3, z: 1 }
 *
 * const entries = new Map([['beta', 2], ['alpha', 1], ['gamma', 3]])
 * toSortedObjectFromEntries(entries)
 * // { alpha: 1, beta: 2, gamma: 3 }
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function toSortedObjectFromEntries<T = unknown>(
  entries: Iterable<[PropertyKey, T]>,
): SortedObject<T> {
  const otherEntries = []
  const symbolEntries = []
  // Use for-of to work with entries iterators.
  for (const entry of entries) {
    if (typeof entry[0] === 'symbol') {
      symbolEntries.push(entry)
    } else {
      otherEntries.push(entry)
    }
  }
  if (!otherEntries.length && !symbolEntries.length) {
    return {}
  }
  return ObjectFromEntries([
    // The String constructor is safe to use with symbols.
    ...symbolEntries.sort(entryKeyComparator),
    ...otherEntries.sort(entryKeyComparator),
  ])
}
