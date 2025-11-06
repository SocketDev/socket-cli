/**
 * @fileoverview Unit tests for object manipulation utilities.
 *
 * Tests advanced object manipulation and lazy property patterns:
 * - Lazy getters: createLazyGetter(), defineLazyGetter(), defineLazyGetters() with memoization
 * - Property definition: defineGetter() for custom getters on objects
 * - Object utilities: merge(), toSortedObject(), toSortedObjectFromEntries()
 * - Type guards: isObject(), isObjectObject() (excludes arrays/null)
 * - Property access: getOwn(), hasOwn(), getKeys(), hasKeys(), getOwnPropertyValues()
 * - Aliases: objectAssign, objectEntries, objectFreeze (direct references to Object.*)
 * - Constants: createConstantsObject() for frozen objects with typed getters
 * - Sorting: entryKeyComparator() for consistent key ordering
 * Tests validate lazy evaluation, memoization, stats tracking, type narrowing, and edge cases.
 * Lazy getters are critical for performance - deferring expensive computations until needed.
 */

import type { GetterDefObj } from '@socketsecurity/lib/objects'
import {
  createConstantsObject,
  createLazyGetter,
  defineGetter,
  defineLazyGetter,
  defineLazyGetters,
  entryKeyComparator,
  getKeys,
  getOwn,
  getOwnPropertyValues,
  hasKeys,
  hasOwn,
  isObject,
  isObjectObject,
  merge,
  objectAssign,
  objectEntries,
  objectFreeze,
  toSortedObject,
  toSortedObjectFromEntries,
} from '@socketsecurity/lib/objects'
import { describe, expect, it } from 'vitest'

describe('objects', () => {
  describe('createLazyGetter', () => {
    it('should create a lazy getter that memoizes result', () => {
      let callCount = 0
      const getter = createLazyGetter('test', () => {
        callCount += 1
        return 'computed'
      })

      expect(callCount).toBe(0)
      expect(getter()).toBe('computed')
      expect(callCount).toBe(1)
      expect(getter()).toBe('computed')
      expect(callCount).toBe(1) // Should not call again
    })

    it('should track initialization in stats', () => {
      const stats = { initialized: new Set<PropertyKey>() }
      const getter = createLazyGetter('myProp', () => 'value', stats)

      expect(stats.initialized.has('myProp')).toBe(false)
      getter()
      expect(stats.initialized.has('myProp')).toBe(true)
    })
  })

  describe('defineGetter', () => {
    it('should define a getter property', () => {
      const obj = {}
      defineGetter(obj, 'test', () => 'value')

      expect((obj as { test: string }).test).toBe('value')
    })

    it('should return the object', () => {
      const obj = {}
      const result = defineGetter(obj, 'test', () => 'value')
      expect(result).toBe(obj)
    })
  })

  describe('defineLazyGetter', () => {
    it('should define a lazy getter property', () => {
      const obj = {}
      let callCount = 0
      defineLazyGetter(obj, 'test', () => {
        callCount += 1
        return 'value'
      })

      expect(callCount).toBe(0)
      expect((obj as { test: string }).test).toBe('value')
      expect(callCount).toBe(1)
      expect((obj as { test: string }).test).toBe('value')
      expect(callCount).toBe(1)
    })
  })

  describe('entryKeyComparator', () => {
    it('should compare entry keys alphabetically', () => {
      expect(entryKeyComparator(['a', 1], ['b', 2])).toBeLessThan(0)
      expect(entryKeyComparator(['b', 1], ['a', 2])).toBeGreaterThan(0)
      expect(entryKeyComparator(['a', 1], ['a', 2])).toBe(0)
    })

    it('should handle symbol keys', () => {
      const sym1 = Symbol('a')
      const sym2 = Symbol('b')
      const result = entryKeyComparator([sym1, 1], [sym2, 2])
      expect(typeof result).toBe('number')
    })

    it('should handle number keys', () => {
      expect(entryKeyComparator([1, 'a'], [2, 'b'])).toBeLessThan(0)
      expect(entryKeyComparator([2, 'a'], [1, 'b'])).toBeGreaterThan(0)
    })
  })

  describe('getKeys', () => {
    it('should return enumerable own keys', () => {
      const obj = { a: 1, b: 2, c: 3 }
      const keys = getKeys(obj)
      expect(keys).toEqual(['a', 'b', 'c'])
    })

    it('should return empty array for non-objects', () => {
      expect(getKeys(null)).toEqual([])
      expect(getKeys(undefined)).toEqual([])
      expect(getKeys(123)).toEqual([])
      expect(getKeys('string')).toEqual([])
    })

    it('should return empty array for objects without keys', () => {
      expect(getKeys({})).toEqual([])
    })
  })

  describe('getOwn', () => {
    it('should get own property value', () => {
      const obj = { a: 1, b: 2 }
      expect(getOwn(obj, 'a')).toBe(1)
      expect(getOwn(obj, 'b')).toBe(2)
    })

    it('should return undefined for non-existent properties', () => {
      const obj = { a: 1 }
      expect(getOwn(obj, 'b')).toBeUndefined()
    })

    it('should return undefined for null/undefined', () => {
      expect(getOwn(null, 'a')).toBeUndefined()
      expect(getOwn(undefined, 'a')).toBeUndefined()
    })

    it('should not access prototype properties', () => {
      const proto = { inherited: 'value' }
      const obj = Object.create(proto)
      obj.own = 'owned'
      expect(getOwn(obj, 'own')).toBe('owned')
      expect(getOwn(obj, 'inherited')).toBeUndefined()
    })
  })

  describe('getOwnPropertyValues', () => {
    it('should return all own property values', () => {
      const obj = { a: 1, b: 2, c: 3 }
      const values = getOwnPropertyValues(obj)
      expect(values).toContain(1)
      expect(values).toContain(2)
      expect(values).toContain(3)
      expect(values).toHaveLength(3)
    })

    it('should return empty array for null/undefined', () => {
      expect(getOwnPropertyValues(null)).toEqual([])
      expect(getOwnPropertyValues(undefined)).toEqual([])
    })

    it('should return empty array for objects without properties', () => {
      expect(getOwnPropertyValues({})).toEqual([])
    })
  })

  describe('hasKeys', () => {
    it('should return true for objects with keys', () => {
      expect(hasKeys({ a: 1 })).toBe(true)
      expect(hasKeys({ a: 1, b: 2 })).toBe(true)
    })

    it('should return false for empty objects', () => {
      expect(hasKeys({})).toBe(false)
    })

    it('should return false for null/undefined', () => {
      expect(hasKeys(null)).toBe(false)
      expect(hasKeys(undefined)).toBe(false)
    })

    it('should only check enumerable own properties', () => {
      const obj = Object.create({ inherited: 1 })
      expect(hasKeys(obj)).toBe(false)
      obj.own = 1
      expect(hasKeys(obj)).toBe(true)
    })
  })

  describe('hasOwn', () => {
    it('should return true for own properties', () => {
      const obj = { a: 1, b: 2 }
      expect(hasOwn(obj, 'a')).toBe(true)
      expect(hasOwn(obj, 'b')).toBe(true)
    })

    it('should return false for non-existent properties', () => {
      const obj = { a: 1 }
      expect(hasOwn(obj, 'b')).toBe(false)
    })

    it('should return false for null/undefined', () => {
      expect(hasOwn(null, 'a')).toBe(false)
      expect(hasOwn(undefined, 'a')).toBe(false)
    })

    it('should not detect inherited properties', () => {
      const proto = { inherited: 1 }
      const obj = Object.create(proto)
      expect(hasOwn(obj, 'inherited')).toBe(false)
    })
  })

  describe('isObject', () => {
    it('should return true for objects', () => {
      expect(isObject({})).toBe(true)
      expect(isObject({ a: 1 })).toBe(true)
      expect(isObject([])).toBe(true)
      expect(isObject(new Date())).toBe(true)
    })

    it('should return false for primitives', () => {
      expect(isObject(null)).toBe(false)
      expect(isObject(undefined)).toBe(false)
      expect(isObject(123)).toBe(false)
      expect(isObject('string')).toBe(false)
      expect(isObject(true)).toBe(false)
    })
  })

  describe('isObjectObject', () => {
    it('should return true for plain objects', () => {
      expect(isObjectObject({})).toBe(true)
      expect(isObjectObject({ a: 1 })).toBe(true)
      expect(isObjectObject(Object.create(null))).toBe(true)
    })

    it('should return false for arrays', () => {
      expect(isObjectObject([])).toBe(false)
      expect(isObjectObject([1, 2, 3])).toBe(false)
    })

    it('should return false for other objects', () => {
      expect(isObjectObject(new Date())).toBe(false)
      expect(isObjectObject(new Map())).toBe(false)
      expect(isObjectObject(new Set())).toBe(false)
    })

    it('should return false for primitives', () => {
      expect(isObjectObject(null)).toBe(false)
      expect(isObjectObject(undefined)).toBe(false)
      expect(isObjectObject(123)).toBe(false)
    })
  })

  describe('objectAssign', () => {
    it('should copy properties from source to target', () => {
      const target = { a: 1 }
      const source = { b: 2, c: 3 }
      const result = objectAssign(target, source)
      expect(result).toBe(target)
      expect(result).toEqual({ a: 1, b: 2, c: 3 })
    })

    it('should handle multiple sources', () => {
      const result = objectAssign({}, { a: 1 }, { b: 2 }, { c: 3 })
      expect(result).toEqual({ a: 1, b: 2, c: 3 })
    })

    it('should overwrite existing properties', () => {
      const result = objectAssign({ a: 1 }, { a: 2 })
      expect(result).toEqual({ a: 2 })
    })
  })

  describe('objectEntries', () => {
    it('should return entries for objects', () => {
      const obj = { a: 1, b: 2 }
      const entries = objectEntries(obj)
      expect(entries).toContainEqual(['a', 1])
      expect(entries).toContainEqual(['b', 2])
    })

    it('should return empty array for null/undefined', () => {
      expect(objectEntries(null)).toEqual([])
      expect(objectEntries(undefined)).toEqual([])
    })

    it('should include symbol keys', () => {
      const sym = Symbol('test')
      const obj = { [sym]: 'value', a: 1 }
      const entries = objectEntries(obj)
      expect(entries).toContainEqual([sym, 'value'])
      expect(entries).toContainEqual(['a', 1])
    })
  })

  describe('objectFreeze', () => {
    it('should freeze an object', () => {
      const obj = { a: 1 }
      const frozen = objectFreeze(obj)
      expect(Object.isFrozen(frozen)).toBe(true)
    })

    it('should prevent modifications', () => {
      const obj = { a: 1 }
      const frozen = objectFreeze(obj)
      expect(() => {
        ;(frozen as { a: number; b?: number }).b = 2
      }).toThrow()
    })
  })

  describe('merge', () => {
    it('should deep merge objects', () => {
      const target = { a: 1, b: { c: 2 } }
      const source = { b: { d: 3 }, e: 4 }
      const result = merge(target, source)
      expect(result).toEqual({ a: 1, b: { c: 2, d: 3 }, e: 4 })
    })

    it('should replace arrays instead of merging', () => {
      const target = { a: [1, 2] }
      const source = { a: [3, 4] }
      const result = merge(target, source)
      expect(result).toEqual({ a: [3, 4] })
    })

    it('should handle nested objects', () => {
      const target = { a: { b: { c: 1 } } }
      const source = { a: { b: { d: 2 } } }
      const result = merge(target, source)
      expect(result).toEqual({ a: { b: { c: 1, d: 2 } } })
    })

    it('should handle non-object inputs', () => {
      expect(merge(null as unknown as object, { a: 1 })).toBeNull()
      expect(merge({ a: 1 }, null as unknown as object)).toEqual({ a: 1 })
    })
  })

  describe('toSortedObject', () => {
    it('should sort object keys alphabetically', () => {
      const obj = { c: 3, a: 1, b: 2 }
      const sorted = toSortedObject(obj)
      expect(Object.keys(sorted)).toEqual(['a', 'b', 'c'])
    })

    it('should preserve values', () => {
      const obj = { c: 3, a: 1, b: 2 }
      const sorted = toSortedObject(obj)
      expect(sorted).toEqual({ a: 1, b: 2, c: 3 })
    })

    it('should handle empty objects', () => {
      const sorted = toSortedObject({})
      expect(sorted).toEqual({})
    })
  })

  describe('toSortedObjectFromEntries', () => {
    it('should create sorted object from entries', () => {
      const entries: Array<[PropertyKey, number]> = [
        ['c', 3],
        ['a', 1],
        ['b', 2],
      ]
      const sorted = toSortedObjectFromEntries(entries)
      expect(Object.keys(sorted)).toEqual(['a', 'b', 'c'])
      expect(sorted).toEqual({ a: 1, b: 2, c: 3 })
    })

    it('should handle symbol keys', () => {
      const sym1 = Symbol('a')
      const sym2 = Symbol('b')
      const entries: Array<[PropertyKey, number]> = [
        [sym2, 2],
        ['a', 1],
        [sym1, 3],
      ]
      const sorted = toSortedObjectFromEntries(entries)
      expect(sorted).toHaveProperty('a')
      expect(sorted[sym1]).toBe(3)
      expect(sorted[sym2]).toBe(2)
    })

    it('should handle empty entries', () => {
      const sorted = toSortedObjectFromEntries([])
      expect(sorted).toEqual({})
    })
  })

  describe('createConstantsObject', () => {
    it('should create a frozen object with properties', () => {
      const obj = createConstantsObject({ a: 1, b: 2 })
      expect(Object.isFrozen(obj)).toBe(true)
      expect((obj as { a: number }).a).toBe(1)
    })

    it('should create object with lazy getters', () => {
      let callCount = 0
      const obj = createConstantsObject(
        { base: 'value' },
        {
          getters: {
            computed: () => {
              callCount += 1
              return 'result'
            },
          },
        },
      )
      expect(callCount).toBe(0)
      expect((obj as { computed: string }).computed).toBe('result')
      expect(callCount).toBe(1)
      expect((obj as { computed: string }).computed).toBe('result')
      expect(callCount).toBe(1)
    })

    it('should create object with mixin properties', () => {
      const obj = createConstantsObject(
        { a: 1 },
        {
          mixin: {
            b: 2,
            c: 3,
          },
        },
      )
      expect((obj as { a: number; b: number; c: number }).a).toBe(1)
      expect((obj as { a: number; b: number; c: number }).b).toBe(2)
      expect((obj as { a: number; b: number; c: number }).c).toBe(3)
    })

    it('should not override props with mixin', () => {
      const obj = createConstantsObject(
        { a: 1, b: 2 },
        {
          mixin: {
            b: 99,
            c: 3,
          },
        },
      )
      expect((obj as { a: number; b: number; c: number }).a).toBe(1)
      expect((obj as { a: number; b: number; c: number }).b).toBe(2)
      expect((obj as { a: number; b: number; c: number }).c).toBe(3)
    })

    it('should handle undefined options', () => {
      const obj = createConstantsObject({ a: 1 }, undefined)
      expect((obj as { a: number }).a).toBe(1)
      expect(Object.isFrozen(obj)).toBe(true)
    })
  })

  describe('defineLazyGetters', () => {
    it('should define multiple lazy getters', () => {
      const obj = {}
      let count1 = 0
      let count2 = 0

      defineLazyGetters(obj, {
        prop1: () => {
          count1 += 1
          return 'value1'
        },
        prop2: () => {
          count2 += 1
          return 'value2'
        },
      })

      expect(count1).toBe(0)
      expect(count2).toBe(0)
      expect((obj as { prop1: string }).prop1).toBe('value1')
      expect(count1).toBe(1)
      expect(count2).toBe(0)
      expect((obj as { prop2: string }).prop2).toBe('value2')
      expect(count1).toBe(1)
      expect(count2).toBe(1)
    })

    it('should handle undefined getterDefObj', () => {
      const obj = {}
      const result = defineLazyGetters(obj, undefined)
      expect(result).toBe(obj)
    })

    it('should handle null getterDefObj', () => {
      const obj = {}
      const result = defineLazyGetters(obj, null as unknown as GetterDefObj)
      expect(result).toBe(obj)
    })

    it('should handle symbol keys in getters', () => {
      const obj = {}
      const sym = Symbol('test')
      defineLazyGetters(obj, {
        [sym]: () => 'symbol-value',
      })
      expect((obj as { [key: symbol]: string })[sym]).toBe('symbol-value')
    })

    it('should handle empty getter object', () => {
      const obj = {}
      defineLazyGetters(obj, {})
      expect(obj).toEqual({})
    })
  })

  describe('merge - additional edge cases', () => {
    it('should handle symbol keys', () => {
      const sym = Symbol('test')
      const target = { a: 1 }
      const source = { [sym]: 'value', b: 2 }
      merge(target, source)
      expect((target as unknown as Record<symbol, string>)[sym]).toBe('value')
      expect((target as { a: number; b: number }).b).toBe(2)
    })

    it('should replace object with array', () => {
      const target = { a: { b: 1 } }
      const source = { a: [1, 2, 3] }
      merge(target, source)
      expect(target.a).toEqual([1, 2, 3])
    })

    it('should replace array with object', () => {
      const target = { a: [1, 2, 3] }
      const source = { a: { b: 1 } }
      merge(target, source)
      expect(target.a).toEqual({ b: 1 })
    })

    it('should handle null values', () => {
      const target = { a: { b: 1 } }
      const source = { a: null }
      merge(target, source)
      expect(target.a).toBe(null)
    })

    it('should handle undefined values', () => {
      const target = { a: { b: 1 } }
      const source = { a: undefined }
      merge(target, source)
      expect(target.a).toBe(undefined)
    })

    it('should handle merging into empty object', () => {
      const target = {}
      const source = { a: 1, b: { c: 2 } }
      merge(target, source)
      expect(target).toEqual({ a: 1, b: { c: 2 } })
    })

    it('should handle deeply nested structures', () => {
      const target = { a: { b: { c: { d: 1 } } } }
      const source = { a: { b: { c: { e: 2 } } } }
      merge(target, source)
      expect(target).toEqual({ a: { b: { c: { d: 1, e: 2 } } } })
    })
  })

  describe('objectEntries - additional tests', () => {
    it('should include non-enumerable properties', () => {
      const obj = { a: 1 }
      Object.defineProperty(obj, 'hidden', {
        value: 'secret',
        enumerable: false,
      })
      const entries = objectEntries(obj)
      expect(entries).toContainEqual(['a', 1])
      expect(entries).toContainEqual(['hidden', 'secret'])
    })

    it('should work with arrays', () => {
      const arr = ['a', 'b']
      const entries = objectEntries(arr)
      expect(entries).toContainEqual(['0', 'a'])
      expect(entries).toContainEqual(['1', 'b'])
      expect(entries).toContainEqual(['length', 2])
    })
  })

  describe('getOwnPropertyValues - additional tests', () => {
    it('should include non-enumerable properties', () => {
      const obj = { a: 1 }
      Object.defineProperty(obj, 'hidden', {
        value: 'secret',
        enumerable: false,
      })
      const values = getOwnPropertyValues(obj)
      expect(values).toContain(1)
      expect(values).toContain('secret')
    })
  })

  describe('toSortedObject - additional tests', () => {
    it('should handle symbol keys', () => {
      const sym1 = Symbol('z')
      const sym2 = Symbol('a')
      const obj = { z: 1, a: 2, [sym1]: 3, [sym2]: 4 }
      const sorted = toSortedObject(obj)
      expect(sorted[sym1]).toBe(3)
      expect(sorted[sym2]).toBe(4)
      expect((sorted as { a: number }).a).toBe(2)
    })

    it('should handle number keys', () => {
      const obj = { 3: 'three', 1: 'one', 2: 'two' }
      const sorted = toSortedObject(obj)
      const keys = Object.keys(sorted)
      expect(keys).toEqual(['1', '2', '3'])
    })
  })

  describe('toSortedObjectFromEntries - additional tests', () => {
    it('should work with Map entries', () => {
      const map = new Map<PropertyKey, string>([
        ['z', 'last'],
        ['a', 'first'],
        ['m', 'middle'],
      ])
      const sorted = toSortedObjectFromEntries(map)
      expect(Object.keys(sorted)).toEqual(['a', 'm', 'z'])
      expect(sorted).toEqual({ a: 'first', m: 'middle', z: 'last' })
    })

    it('should handle only symbol entries', () => {
      const sym1 = Symbol('first')
      const sym2 = Symbol('second')
      const sorted = toSortedObjectFromEntries([
        [sym2, 2],
        [sym1, 1],
      ])
      expect(sorted[sym1]).toBe(1)
      expect(sorted[sym2]).toBe(2)
    })
  })

  describe('getKeys - additional tests', () => {
    it('should work with arrays', () => {
      const arr = ['a', 'b', 'c']
      const keys = getKeys(arr)
      expect(keys).toEqual(['0', '1', '2'])
    })
  })

  describe('getOwn - additional tests', () => {
    it('should handle symbol keys', () => {
      const sym = Symbol('test')
      const obj = { [sym]: 'value' }
      expect(getOwn(obj, sym)).toBe('value')
    })

    it('should handle number keys', () => {
      const obj = { 123: 'value' }
      expect(getOwn(obj, 123)).toBe('value')
    })

    it('should handle arrays', () => {
      const arr = ['a', 'b', 'c']
      expect(getOwn(arr, 0)).toBe('a')
      expect(getOwn(arr, '1')).toBe('b')
      expect(getOwn(arr, 'length')).toBe(3)
    })
  })

  describe('hasOwn - additional tests', () => {
    it('should work with symbol keys', () => {
      const sym = Symbol('test')
      const obj = { [sym]: 'value' }
      expect(hasOwn(obj, sym)).toBe(true)
      expect(hasOwn(obj, Symbol('other'))).toBe(false)
    })

    it('should work with arrays', () => {
      const arr = ['a', 'b', 'c']
      expect(hasOwn(arr, 0)).toBe(true)
      expect(hasOwn(arr, 3)).toBe(false)
      expect(hasOwn(arr, 'length')).toBe(true)
    })

    it('should handle non-enumerable properties', () => {
      const obj = {}
      Object.defineProperty(obj, 'hidden', {
        value: 'secret',
        enumerable: false,
      })
      expect(hasOwn(obj, 'hidden')).toBe(true)
    })
  })

  describe('defineGetter - additional tests', () => {
    it('should create non-enumerable getter', () => {
      const obj = {}
      defineGetter(obj, 'test', () => 'value')
      expect(Object.keys(obj)).toEqual([])
      expect(Object.getOwnPropertyNames(obj)).toContain('test')
    })

    it('should work with symbol keys', () => {
      const obj = {}
      const sym = Symbol('test')
      defineGetter(obj, sym, () => 'symbol-value')
      expect((obj as { [key: symbol]: string })[sym]).toBe('symbol-value')
    })
  })

  describe('defineLazyGetter - additional tests', () => {
    it('should work with symbol keys', () => {
      const obj = {}
      const sym = Symbol('lazy')
      let called = false
      defineLazyGetter(obj, sym, () => {
        called = true
        return 'value'
      })

      expect(called).toBe(false)
      expect((obj as { [key: symbol]: string })[sym]).toBe('value')
      expect(called).toBe(true)
    })

    it('should be non-enumerable', () => {
      const obj = { regular: 'prop' }
      defineLazyGetter(obj, 'lazy', () => 'value')
      expect(Object.keys(obj)).toEqual(['regular'])
    })
  })

  describe('createLazyGetter - additional tests', () => {
    it('should work with symbol property names', () => {
      const sym = Symbol('myProp')
      const stats = { initialized: new Set<PropertyKey>() }
      const getter = createLazyGetter(sym, () => 'value', stats)

      expect(stats.initialized.has(sym)).toBe(false)
      expect(getter()).toBe('value')
      expect(stats.initialized.has(sym)).toBe(true)
    })

    it('should work with number property names', () => {
      const stats = { initialized: new Set<PropertyKey>() }
      const getter = createLazyGetter(123, () => 'value', stats)

      expect(stats.initialized.has(123)).toBe(false)
      expect(getter()).toBe('value')
      expect(stats.initialized.has(123)).toBe(true)
    })

    it('should memoize falsy values', () => {
      let callCount = 0
      const getter = createLazyGetter('test', () => {
        callCount += 1
        return 0
      })

      expect(getter()).toBe(0)
      expect(callCount).toBe(1)
      expect(getter()).toBe(0)
      expect(callCount).toBe(1)
    })

    it('should memoize null values', () => {
      let callCount = 0
      const getter = createLazyGetter('test', () => {
        callCount += 1
        return null
      })

      expect(getter()).toBe(null)
      expect(callCount).toBe(1)
      expect(getter()).toBe(null)
      expect(callCount).toBe(1)
    })
  })

  describe('isObjectObject - additional tests', () => {
    it('should return false for RegExp', () => {
      expect(isObjectObject(/test/)).toBe(false)
    })

    it('should return false for Error', () => {
      expect(isObjectObject(new Error())).toBe(false)
    })

    it('should return true for Object.create(Object.prototype)', () => {
      expect(isObjectObject(Object.create(Object.prototype))).toBe(true)
    })

    it('should return false for objects with custom prototypes', () => {
      const proto = { custom: true }
      const obj = Object.create(proto)
      expect(isObjectObject(obj)).toBe(false)
    })
  })

  describe('isObject - additional tests', () => {
    it('should return true for class instances', () => {
      class MyClass {}
      expect(isObject(new MyClass())).toBe(true)
    })

    it('should return true for RegExp', () => {
      expect(isObject(/test/)).toBe(true)
    })

    it('should return false for symbols', () => {
      expect(isObject(Symbol('test'))).toBe(false)
    })
  })

  describe('hasKeys - additional tests', () => {
    it('should return true for arrays with elements', () => {
      expect(hasKeys([1, 2, 3])).toBe(true)
    })

    it('should return false for empty arrays', () => {
      expect(hasKeys([])).toBe(false)
    })

    it('should return false for objects with only non-enumerable properties', () => {
      const obj = {}
      Object.defineProperty(obj, 'hidden', {
        value: 'secret',
        enumerable: false,
      })
      expect(hasKeys(obj)).toBe(false)
    })
  })
})
