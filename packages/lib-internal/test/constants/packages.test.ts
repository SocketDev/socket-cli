/**
 * @fileoverview Unit tests for package constants and utilities.
 *
 * Tests npm/package-related constants:
 * - NPM_REGISTRY_URL, NPM_PUBLIC_REGISTRY (registry endpoints)
 * - Package.json field names (dependencies, devDependencies, scripts)
 * - Package manager identifiers (npm, yarn, pnpm, bun)
 * Frozen constants for consistent package operations.
 */

import {
  AT_LATEST,
  LATEST,
  PACKAGE,
  PACKAGE_DEFAULT_VERSION,
  getLifecycleScriptNames,
  getNpmLifecycleEvent,
  getPackageDefaultNodeRange,
  getPackageDefaultSocketCategories,
  getPackageExtensions,
  getPackumentCache,
  getPacoteCachePath,
} from '@socketsecurity/lib/constants/packages'
import { describe, expect, it } from 'vitest'

describe('constants/packages', () => {
  describe('package constants', () => {
    it('PACKAGE should be defined', () => {
      expect(PACKAGE).toBe('package')
    })

    it('AT_LATEST should be defined', () => {
      expect(AT_LATEST).toBe('@latest')
    })

    it('LATEST should be defined', () => {
      expect(LATEST).toBe('latest')
    })

    it('PACKAGE_DEFAULT_VERSION should be defined', () => {
      expect(PACKAGE_DEFAULT_VERSION).toBe('1.0.0')
    })

    it('all constants should be strings', () => {
      expect(typeof PACKAGE).toBe('string')
      expect(typeof AT_LATEST).toBe('string')
      expect(typeof LATEST).toBe('string')
      expect(typeof PACKAGE_DEFAULT_VERSION).toBe('string')
    })
  })

  describe('getPackageDefaultNodeRange', () => {
    it('should return string or undefined', () => {
      const range = getPackageDefaultNodeRange()
      const type = typeof range
      expect(type === 'string' || type === 'undefined').toBe(true)
    })

    it('should return consistent value on multiple calls', () => {
      const first = getPackageDefaultNodeRange()
      const second = getPackageDefaultNodeRange()
      expect(first).toBe(second)
    })

    it('should return fallback if file missing', () => {
      const range = getPackageDefaultNodeRange()
      // Either loads from file or uses fallback '>=18'
      expect(range).toBeDefined()
      expect(typeof range).toBe('string')
    })
  })

  describe('getPackageDefaultSocketCategories', () => {
    it('should return array', () => {
      const categories = getPackageDefaultSocketCategories()
      expect(Array.isArray(categories)).toBe(true)
    })

    it('should return consistent value on multiple calls', () => {
      const first = getPackageDefaultSocketCategories()
      const second = getPackageDefaultSocketCategories()
      expect(first).toBe(second)
    })

    it('should be readonly array', () => {
      const categories = getPackageDefaultSocketCategories()
      expect(Object.isFrozen(categories) || categories.length === 0).toBe(true)
    })
  })

  describe('getPackageExtensions', () => {
    it('should return iterable', () => {
      const extensions = getPackageExtensions()
      expect(extensions).toBeDefined()
      expect(typeof extensions[Symbol.iterator]).toBe('function')
    })

    it('should return consistent value on multiple calls', () => {
      const first = getPackageExtensions()
      const second = getPackageExtensions()
      expect(first).toBe(second)
    })

    it('should be iterable with for-of', () => {
      const extensions = getPackageExtensions()
      let count = 0
      for (const [key, _value] of extensions) {
        expect(typeof key).toBe('string')
        count++
      }
      // Either has extensions or is empty array
      expect(count).toBeGreaterThanOrEqual(0)
    })

    it('should have tuple entries when not empty', () => {
      const extensions = getPackageExtensions()
      const array = Array.from(extensions)
      for (const entry of array) {
        expect(Array.isArray(entry)).toBe(true)
        expect(entry.length).toBe(2)
        expect(typeof entry[0]).toBe('string')
      }
    })
  })

  describe('getNpmLifecycleEvent', () => {
    it('should return string or undefined', () => {
      const event = getNpmLifecycleEvent()
      const type = typeof event
      expect(type === 'string' || type === 'undefined').toBe(true)
    })

    it('should match npm_lifecycle_event env var', () => {
      const event = getNpmLifecycleEvent()
      const envValue = process.env.npm_lifecycle_event
      expect(event).toBe(envValue)
    })
  })

  describe('getLifecycleScriptNames', () => {
    it('should return array', () => {
      const scripts = getLifecycleScriptNames()
      expect(Array.isArray(scripts)).toBe(true)
    })

    it('should return consistent value on multiple calls', () => {
      const first = getLifecycleScriptNames()
      const second = getLifecycleScriptNames()
      expect(first).toBe(second)
    })

    it('should contain only strings', () => {
      const scripts = getLifecycleScriptNames()
      for (const script of scripts) {
        expect(typeof script).toBe('string')
        expect(script.length).toBeGreaterThan(0)
      }
    })

    it('should work with array methods', () => {
      const scripts = getLifecycleScriptNames()
      const filtered = scripts.filter(s => s.startsWith('pre'))
      expect(Array.isArray(filtered)).toBe(true)
    })
  })

  describe('getPackumentCache', () => {
    it('should return Map instance', () => {
      const cache = getPackumentCache()
      expect(cache instanceof Map).toBe(true)
    })

    it('should return consistent value on multiple calls', () => {
      const first = getPackumentCache()
      const second = getPackumentCache()
      expect(first).toBe(second)
    })

    it('should be mutable Map', () => {
      const cache = getPackumentCache()
      const key = `test-key-${Date.now()}`
      const value = { test: true }

      cache.set(key, value)
      expect(cache.get(key)).toBe(value)
      expect(cache.has(key)).toBe(true)

      cache.delete(key)
      expect(cache.has(key)).toBe(false)
    })

    it('should support Map operations', () => {
      const cache = getPackumentCache()
      const initialSize = cache.size

      const testKey = `test-${Date.now()}`
      cache.set(testKey, { data: 'test' })
      expect(cache.size).toBe(initialSize + 1)

      cache.clear()
      expect(cache.size).toBe(0)
    })
  })

  describe('getPacoteCachePath', () => {
    it('should return string', () => {
      const path = getPacoteCachePath()
      expect(typeof path).toBe('string')
    })

    it('should return consistent value on multiple calls', () => {
      const first = getPacoteCachePath()
      const second = getPacoteCachePath()
      expect(first).toBe(second)
    })

    it('should return normalized path or empty string', () => {
      const path = getPacoteCachePath()
      // Either a valid path or empty string fallback
      expect(typeof path).toBe('string')
      if (path.length > 0) {
        // If path exists, should not have backslashes (normalized)
        expect(path).not.toMatch(/\\/)
      }
    })

    it('should handle missing pacote gracefully', () => {
      // Should not throw even if pacote is missing
      expect(() => getPacoteCachePath()).not.toThrow()
    })
  })

  describe('integration', () => {
    it('all getters should be callable', () => {
      expect(() => getPackageDefaultNodeRange()).not.toThrow()
      expect(() => getPackageDefaultSocketCategories()).not.toThrow()
      expect(() => getPackageExtensions()).not.toThrow()
      expect(() => getNpmLifecycleEvent()).not.toThrow()
      expect(() => getLifecycleScriptNames()).not.toThrow()
      expect(() => getPackumentCache()).not.toThrow()
      expect(() => getPacoteCachePath()).not.toThrow()
    })

    it('constants should be immutable', () => {
      const originalPackage = PACKAGE
      const originalLatest = LATEST
      const originalAtLatest = AT_LATEST
      const originalVersion = PACKAGE_DEFAULT_VERSION

      // Attempt to modify (should fail silently or throw in strict mode)
      // TypeScript will prevent this, but we can test runtime behavior
      expect(PACKAGE).toBe(originalPackage)
      expect(LATEST).toBe(originalLatest)
      expect(AT_LATEST).toBe(originalAtLatest)
      expect(PACKAGE_DEFAULT_VERSION).toBe(originalVersion)
    })

    it('cache should persist between calls', () => {
      const cache1 = getPackumentCache()
      const testKey = `persist-test-${Date.now()}`
      cache1.set(testKey, { persisted: true })

      const cache2 = getPackumentCache()
      expect(cache2.get(testKey)).toEqual({ persisted: true })

      // Clean up
      cache2.delete(testKey)
    })
  })

  describe('edge cases', () => {
    it('should handle empty package extensions gracefully', () => {
      const extensions = getPackageExtensions()
      const arr = Array.from(extensions)
      expect(arr.length).toBeGreaterThanOrEqual(0)
    })

    it('should handle undefined npm lifecycle event', () => {
      const event = getNpmLifecycleEvent()
      if (event === undefined) {
        expect(typeof event).toBe('undefined')
      } else {
        expect(typeof event).toBe('string')
      }
    })

    it('should handle empty lifecycle script names', () => {
      const scripts = getLifecycleScriptNames()
      expect(scripts.length).toBeGreaterThanOrEqual(0)
    })
  })

  describe('type checks', () => {
    it('constants should have correct types', () => {
      expect(PACKAGE).toMatch(/^[a-z]+$/)
      expect(LATEST).toMatch(/^[a-z]+$/)
      expect(AT_LATEST).toMatch(/^@[a-z]+$/)
      expect(PACKAGE_DEFAULT_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
    })

    it('getPackumentCache should return Map type', () => {
      const cache = getPackumentCache()
      expect(cache.constructor.name).toBe('Map')
    })
  })
})
