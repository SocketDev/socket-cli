/**
 * @fileoverview Tests for update store cache functionality.
 *
 * Tests cover:
 * - Cache get/set/clear operations
 * - TTL-based freshness checking
 * - Package listing
 * - Atomic operations and locking
 *
 * Note: These tests use the real file system but with test-specific paths.
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { UpdateStore } from '../../../../src/store.mts'

import type { StoreRecord } from '../../../../src/store.mts'

describe('store', () => {
  let testStore: UpdateStore
  let testStorePath: string

  beforeEach(() => {
    // Create a unique test store path
    testStorePath = path.join(
      os.tmpdir(),
      `socket-cli-test-store-${Date.now()}.json`,
    )
    testStore = new UpdateStore({ storePath: testStorePath })
  })

  afterEach(async () => {
    // Clean up test store file
    try {
      if (existsSync(testStorePath)) {
        await fs.unlink(testStorePath)
      }
      if (existsSync(`${testStorePath}.lock`)) {
        await fs.unlink(`${testStorePath}.lock`)
      }
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('get', () => {
    it('should return undefined when store does not exist', () => {
      const result = testStore.get('test-package')
      expect(result).toBeUndefined()
    })

    it('should return undefined when package is not in store', async () => {
      const record: StoreRecord = {
        timestampFetch: Date.now(),
        timestampNotification: 0,
        version: '1.0.0',
      }

      await testStore.set('package-a', record)

      const result = testStore.get('package-b')
      expect(result).toBeUndefined()
    })

    it('should return record when package exists', async () => {
      const record: StoreRecord = {
        timestampFetch: Date.now(),
        timestampNotification: 0,
        version: '1.0.0',
      }

      await testStore.set('test-package', record)

      const result = testStore.get('test-package')
      expect(result).toBeDefined()
      expect(result?.version).toBe('1.0.0')
      expect(result?.timestampFetch).toBe(record.timestampFetch)
    })
  })

  describe('set', () => {
    it('should create store file when it does not exist', async () => {
      const record: StoreRecord = {
        timestampFetch: Date.now(),
        timestampNotification: 0,
        version: '1.0.0',
      }

      await testStore.set('test-package', record)

      expect(existsSync(testStorePath)).toBe(true)
    })

    it('should store record correctly', async () => {
      const record: StoreRecord = {
        timestampFetch: Date.now(),
        timestampNotification: 0,
        version: '1.2.3',
      }

      await testStore.set('test-package', record)

      const result = testStore.get('test-package')
      expect(result).toEqual(record)
    })

    it('should update existing record', async () => {
      const record1: StoreRecord = {
        timestampFetch: Date.now(),
        timestampNotification: 0,
        version: '1.0.0',
      }

      await testStore.set('test-package', record1)

      const record2: StoreRecord = {
        timestampFetch: Date.now() + 1000,
        timestampNotification: 0,
        version: '2.0.0',
      }

      await testStore.set('test-package', record2)

      const result = testStore.get('test-package')
      expect(result?.version).toBe('2.0.0')
    })

    it('should support multiple packages', async () => {
      const record1: StoreRecord = {
        timestampFetch: Date.now(),
        timestampNotification: 0,
        version: '1.0.0',
      }

      const record2: StoreRecord = {
        timestampFetch: Date.now(),
        timestampNotification: 0,
        version: '2.0.0',
      }

      await testStore.set('package-a', record1)
      await testStore.set('package-b', record2)

      expect(testStore.get('package-a')?.version).toBe('1.0.0')
      expect(testStore.get('package-b')?.version).toBe('2.0.0')
    })
  })

  describe('clear', () => {
    it('should remove specific package', async () => {
      const record: StoreRecord = {
        timestampFetch: Date.now(),
        timestampNotification: 0,
        version: '1.0.0',
      }

      await testStore.set('test-package', record)
      expect(testStore.get('test-package')).toBeDefined()

      await testStore.clear('test-package')
      expect(testStore.get('test-package')).toBeUndefined()
    })

    it('should not affect other packages', async () => {
      const record1: StoreRecord = {
        timestampFetch: Date.now(),
        timestampNotification: 0,
        version: '1.0.0',
      }

      const record2: StoreRecord = {
        timestampFetch: Date.now(),
        timestampNotification: 0,
        version: '2.0.0',
      }

      await testStore.set('package-a', record1)
      await testStore.set('package-b', record2)

      await testStore.clear('package-a')

      expect(testStore.get('package-a')).toBeUndefined()
      expect(testStore.get('package-b')).toBeDefined()
    })
  })

  describe('clearAll', () => {
    it('should remove store file', async () => {
      const record: StoreRecord = {
        timestampFetch: Date.now(),
        timestampNotification: 0,
        version: '1.0.0',
      }

      await testStore.set('test-package', record)
      expect(existsSync(testStorePath)).toBe(true)

      await testStore.clearAll()
      expect(existsSync(testStorePath)).toBe(false)
    })

    it('should remove all packages', async () => {
      const record1: StoreRecord = {
        timestampFetch: Date.now(),
        timestampNotification: 0,
        version: '1.0.0',
      }

      const record2: StoreRecord = {
        timestampFetch: Date.now(),
        timestampNotification: 0,
        version: '2.0.0',
      }

      await testStore.set('package-a', record1)
      await testStore.set('package-b', record2)

      await testStore.clearAll()

      expect(testStore.get('package-a')).toBeUndefined()
      expect(testStore.get('package-b')).toBeUndefined()
    })
  })

  describe('isFresh', () => {
    it('should return false for undefined record', () => {
      expect(testStore.isFresh(undefined, 1000)).toBe(false)
    })

    it('should return true for fresh record', () => {
      const record: StoreRecord = {
        timestampFetch: Date.now(),
        timestampNotification: 0,
        version: '1.0.0',
      }

      expect(testStore.isFresh(record, 1000)).toBe(true)
    })

    it('should return false for expired record', () => {
      // 2 seconds ago
      const record: StoreRecord = {
        timestampFetch: Date.now() - 2000,
        timestampNotification: 0,
        version: '1.0.0',
      }

      // 1 second TTL
      expect(testStore.isFresh(record, 1000)).toBe(false)
    })

    it('should handle edge case at TTL boundary', () => {
      const now = Date.now()
      // Just under 1 second
      const record: StoreRecord = {
        timestampFetch: now - 999,
        timestampNotification: 0,
        version: '1.0.0',
      }

      expect(testStore.isFresh(record, 1000)).toBe(true)
    })
  })

  describe('getAllPackages', () => {
    it('should return empty array when store does not exist', () => {
      const result = testStore.getAllPackages()
      expect(result).toEqual([])
    })

    it('should return all package names', async () => {
      const record1: StoreRecord = {
        timestampFetch: Date.now(),
        timestampNotification: 0,
        version: '1.0.0',
      }

      const record2: StoreRecord = {
        timestampFetch: Date.now(),
        timestampNotification: 0,
        version: '2.0.0',
      }

      await testStore.set('package-a', record1)
      await testStore.set('package-b', record2)

      const packages = testStore.getAllPackages()
      expect(packages).toHaveLength(2)
      expect(packages).toContain('package-a')
      expect(packages).toContain('package-b')
    })
  })

  describe('integration scenarios', () => {
    it('should handle rapid updates', async () => {
      const record1: StoreRecord = {
        timestampFetch: Date.now(),
        timestampNotification: 0,
        version: '1.0.0',
      }

      const record2: StoreRecord = {
        timestampFetch: Date.now(),
        timestampNotification: 0,
        version: '1.1.0',
      }

      const record3: StoreRecord = {
        timestampFetch: Date.now(),
        timestampNotification: 0,
        version: '1.2.0',
      }

      await Promise.allSettled([
        testStore.set('package-a', record1),
        testStore.set('package-b', record2),
        testStore.set('package-c', record3),
      ])

      expect(testStore.get('package-a')?.version).toBe('1.0.0')
      expect(testStore.get('package-b')?.version).toBe('1.1.0')
      expect(testStore.get('package-c')?.version).toBe('1.2.0')
    })

    it('should handle TTL expiration workflow', async () => {
      // 2 seconds ago
      const record: StoreRecord = {
        timestampFetch: Date.now() - 2000,
        timestampNotification: 0,
        version: '1.0.0',
      }

      await testStore.set('test-package', record)

      // Check with short TTL - should be expired
      // 1 second
      const shortTtl = testStore.isFresh(testStore.get('test-package'), 1000)
      expect(shortTtl).toBe(false)

      // Check with long TTL - should be fresh
      // 10 seconds
      const longTtl = testStore.isFresh(testStore.get('test-package'), 10000)
      expect(longTtl).toBe(true)
    })
  })
})
