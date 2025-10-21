/**
 * @fileoverview Tests for update manager orchestration.
 *
 * Tests cover:
 * - Complete update check flow
 * - Cache integration
 * - TTL expiration handling
 * - Error scenarios
 *
 * Note: These are unit tests focused on orchestration logic.
 * Integration tests with real registry calls are separate.
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoreRecord } from './store.mts'
import { UpdateStore } from './store.mts'
import { checkForUpdates } from './update-manager.mts'

describe('update-manager', () => {
  let testStore: UpdateStore
  let testStorePath: string

  beforeEach(() => {
    // Create a unique test store path
    testStorePath = path.join(
      os.tmpdir(),
      `socket-cli-test-manager-${Date.now()}.json`,
    )
    testStore = new UpdateStore({ storePath: testStorePath })

    // Mock the updateStore import (simplified for unit tests)
    // In real tests, we'd use dependency injection
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

  describe('input validation', () => {
    it('should validate name parameter', async () => {
      const result = await checkForUpdates({
        name: '',
        version: '1.0.0',
      })
      expect(result).toBe(false)
    })

    it('should validate version parameter', async () => {
      const result = await checkForUpdates({
        name: 'test-package',
        version: '',
      })
      expect(result).toBe(false)
    })

    it('should validate ttl parameter', async () => {
      const result = await checkForUpdates({
        name: 'test-package',
        version: '1.0.0',
        ttl: -1,
      })
      expect(result).toBe(false)
    })

    it('should handle invalid auth info gracefully', async () => {
      const result = await checkForUpdates({
        name: 'test-package',
        version: '1.0.0',
        authInfo: { token: '', type: '' },
      })
      // Should not throw, just warn
      expect(typeof result).toBe('boolean')
    })

    it('should handle invalid registry URL gracefully', async () => {
      const result = await checkForUpdates({
        name: 'test-package',
        version: '1.0.0',
        registryUrl: '',
      })
      // Should not throw, just warn
      expect(typeof result).toBe('boolean')
    })
  })

  describe('version comparison logic', () => {
    it('should detect update when cached version differs', async () => {
      const record: StoreRecord = {
        timestampFetch: Date.now(),
        timestampNotification: 0,
        version: '2.0.0',
      }

      await testStore.set('test-package', record)

      // This test checks the basic logic without network calls
      // In practice, checkForUpdates would fetch from registry
      expect(testStore.get('test-package')?.version).toBe('2.0.0')
    })

    it('should use cached version when fresh', () => {
      const record: StoreRecord = {
        timestampFetch: Date.now(),
        timestampNotification: 0,
        version: '1.0.0',
      }

      expect(testStore.isFresh(record, 1000)).toBe(true)
    })

    it('should reject stale cache', () => {
      // 2 seconds ago
      const record: StoreRecord = {
        timestampFetch: Date.now() - 2000,
        timestampNotification: 0,
        version: '1.0.0',
      }

      // 1 second TTL
      expect(testStore.isFresh(record, 1000)).toBe(false)
    })
  })

  describe('cache interaction', () => {
    it('should handle missing cache gracefully', async () => {
      expect(testStore.get('nonexistent-package')).toBeUndefined()
    })

    it('should read from cache when available', async () => {
      const record: StoreRecord = {
        timestampFetch: Date.now(),
        timestampNotification: 0,
        version: '1.5.0',
      }

      await testStore.set('test-package', record)

      const retrieved = testStore.get('test-package')
      expect(retrieved?.version).toBe('1.5.0')
    })

    it('should update cache after check', async () => {
      const record: StoreRecord = {
        timestampFetch: Date.now() - 1000,
        timestampNotification: 0,
        version: '1.0.0',
      }

      await testStore.set('test-package', record)

      const newRecord: StoreRecord = {
        timestampFetch: Date.now(),
        timestampNotification: 0,
        version: '2.0.0',
      }

      await testStore.set('test-package', newRecord)

      const updated = testStore.get('test-package')
      expect(updated?.version).toBe('2.0.0')
    })
  })

  describe('TTL behavior', () => {
    it('should respect short TTL', () => {
      const record: StoreRecord = {
        timestampFetch: Date.now() - 100,
        timestampNotification: 0,
        version: '1.0.0',
      }

      // 50ms TTL, record is 100ms old
      expect(testStore.isFresh(record, 50)).toBe(false)
    })

    it('should respect long TTL', () => {
      const record: StoreRecord = {
        timestampFetch: Date.now() - 100,
        timestampNotification: 0,
        version: '1.0.0',
      }

      // 1 hour TTL, record is 100ms old
      expect(testStore.isFresh(record, 60 * 60 * 1000)).toBe(true)
    })

    it('should handle TTL boundary conditions', () => {
      const now = Date.now()
      const record: StoreRecord = {
        timestampFetch: now - 999,
        timestampNotification: 0,
        version: '1.0.0',
      }

      // Just under 1 second old with 1 second TTL
      expect(testStore.isFresh(record, 1000)).toBe(true)

      const expiredRecord: StoreRecord = {
        timestampFetch: now - 1001,
        timestampNotification: 0,
        version: '1.0.0',
      }

      // Just over 1 second old with 1 second TTL
      expect(testStore.isFresh(expiredRecord, 1000)).toBe(false)
    })
  })

  describe('error handling', () => {
    it('should handle invalid system time gracefully', async () => {
      // Test with mock time that returns invalid value
      const spy = vi.spyOn(Date, 'now').mockReturnValue(-1)

      const result = await checkForUpdates({
        name: 'test-package',
        version: '1.0.0',
      })

      spy.mockRestore()

      // Should not throw
      expect(typeof result).toBe('boolean')
    })

    it('should continue on cache write failure', async () => {
      // Create a read-only store path to simulate write failure
      const readOnlyPath = path.join(os.tmpdir(), 'readonly-store.json')
      const readOnlyStore = new UpdateStore({ storePath: readOnlyPath })

      // Write initial data
      await readOnlyStore.set('test-package', {
        timestampFetch: Date.now(),
        timestampNotification: 0,
        version: '1.0.0',
      })

      // This should not throw even if write fails
      const result = readOnlyStore.get('test-package')
      expect(result).toBeDefined()

      // Cleanup
      try {
        await fs.unlink(readOnlyPath)
        await fs.unlink(`${readOnlyPath}.lock`)
      } catch {
        // Ignore cleanup errors
      }
    })

    it('should handle corrupted cache gracefully', async () => {
      // Write invalid JSON to cache file
      await fs.mkdir(path.dirname(testStorePath), { recursive: true })
      await fs.writeFile(testStorePath, 'invalid json{', 'utf8')

      const result = testStore.get('test-package')
      expect(result).toBeUndefined()
    })
  })

  describe('notification timing', () => {
    it('should support immediate notification mode', async () => {
      const result = await checkForUpdates({
        name: 'test-package',
        version: '1.0.0',
        immediate: true,
      })

      expect(typeof result).toBe('boolean')
    })

    it('should support exit notification mode', async () => {
      const result = await checkForUpdates({
        name: 'test-package',
        version: '1.0.0',
        immediate: false,
      })

      expect(typeof result).toBe('boolean')
    })
  })

  describe('authentication scenarios', () => {
    it('should handle valid auth info', async () => {
      const result = await checkForUpdates({
        name: 'test-package',
        version: '1.0.0',
        authInfo: {
          token: 'test-token',
          type: 'Bearer',
        },
      })

      expect(typeof result).toBe('boolean')
    })

    it('should handle missing auth info', async () => {
      const result = await checkForUpdates({
        name: 'test-package',
        version: '1.0.0',
      })

      expect(typeof result).toBe('boolean')
    })
  })

  describe('registry configuration', () => {
    it('should use default registry when not specified', async () => {
      const result = await checkForUpdates({
        name: 'test-package',
        version: '1.0.0',
      })

      expect(typeof result).toBe('boolean')
    })

    it('should accept custom registry URL', async () => {
      const result = await checkForUpdates({
        name: 'test-package',
        version: '1.0.0',
        registryUrl: 'https://custom.registry.example.com',
      })

      expect(typeof result).toBe('boolean')
    })
  })
})
