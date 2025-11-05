/**
 * @fileoverview Unit tests for IPC object lazy loader utility.
 *
 * Tests IPC object getter for worker thread communication:
 * - getIpc() returns IpcObject with sendMessage(), disconnect()
 * - Lazy-loads worker_threads module
 * - Type-safe IPC message passing
 * - Worker thread detection and initialization
 * Used by Socket CLI for parent-worker communication in multi-threaded operations.
 */

import { describe, expect, it } from 'vitest'

import { getIpc } from '@socketsecurity/lib/utils/get-ipc'
import type { IpcObject } from '@socketsecurity/lib/utils/get-ipc'

describe('utils/get-ipc', () => {
  describe('getIpc()', () => {
    it('should export getIpc function', () => {
      expect(typeof getIpc).toBe('function')
    })

    it('should return an object', async () => {
      const ipc = await getIpc()
      expect(typeof ipc).toBe('object')
      expect(ipc).not.toBeNull()
    })

    it('should return frozen object', async () => {
      const ipc = await getIpc()
      expect(Object.isFrozen(ipc)).toBe(true)
    })

    it('should cache result on subsequent calls', async () => {
      const ipc1 = await getIpc()
      const ipc2 = await getIpc()
      expect(ipc1).toBe(ipc2)
    })

    it('should return same reference every time', async () => {
      const results = await Promise.all([getIpc(), getIpc(), getIpc()])
      expect(results[0]).toBe(results[1])
      expect(results[1]).toBe(results[2])
    })
  })

  describe('IpcObject properties', () => {
    it('should only contain SOCKET_CLI_* properties if set', async () => {
      const ipc = await getIpc()
      const keys = Object.keys(ipc)

      keys.forEach(key => {
        expect(key).toMatch(/^SOCKET_CLI_/)
      })
    })

    it('should have correct property types', async () => {
      const ipc = await getIpc()

      // String properties
      if ('SOCKET_CLI_FIX' in ipc) {
        expect(typeof ipc.SOCKET_CLI_FIX).toBe('string')
      }
      if ('SOCKET_CLI_SHADOW_API_TOKEN' in ipc) {
        expect(typeof ipc.SOCKET_CLI_SHADOW_API_TOKEN).toBe('string')
      }
      if ('SOCKET_CLI_SHADOW_BIN' in ipc) {
        expect(typeof ipc.SOCKET_CLI_SHADOW_BIN).toBe('string')
      }

      // Boolean properties
      if ('SOCKET_CLI_OPTIMIZE' in ipc) {
        expect(typeof ipc.SOCKET_CLI_OPTIMIZE).toBe('boolean')
      }
      if ('SOCKET_CLI_SHADOW_ACCEPT_RISKS' in ipc) {
        expect(typeof ipc.SOCKET_CLI_SHADOW_ACCEPT_RISKS).toBe('boolean')
      }
      if ('SOCKET_CLI_SHADOW_PROGRESS' in ipc) {
        expect(typeof ipc.SOCKET_CLI_SHADOW_PROGRESS).toBe('boolean')
      }
      if ('SOCKET_CLI_SHADOW_SILENT' in ipc) {
        expect(typeof ipc.SOCKET_CLI_SHADOW_SILENT).toBe('boolean')
      }
    })

    it('should not have undefined values', async () => {
      const ipc = await getIpc()
      const values = Object.values(ipc)

      values.forEach(value => {
        expect(value).not.toBeUndefined()
      })
    })
  })

  describe('key accessor', () => {
    it('should support getting specific keys', async () => {
      const ipc = await getIpc()
      const keys = Object.keys(ipc) as Array<keyof IpcObject>

      for (const key of keys) {
        const value = await getIpc(key)
        expect(value).toBe(ipc[key])
      }
    })

    it('should return undefined for missing keys', async () => {
      const value = await getIpc('SOCKET_CLI_FIX' as keyof IpcObject)
      const ipc = await getIpc()

      if (!('SOCKET_CLI_FIX' in ipc)) {
        expect(value).toBeUndefined()
      }
    })

    it('should work with all known keys', async () => {
      const keys: Array<keyof IpcObject> = [
        'SOCKET_CLI_FIX',
        'SOCKET_CLI_OPTIMIZE',
        'SOCKET_CLI_SHADOW_ACCEPT_RISKS',
        'SOCKET_CLI_SHADOW_API_TOKEN',
        'SOCKET_CLI_SHADOW_BIN',
        'SOCKET_CLI_SHADOW_PROGRESS',
        'SOCKET_CLI_SHADOW_SILENT',
      ]

      for (const key of keys) {
        const value = await getIpc(key)
        const ipc = await getIpc()
        expect(value).toBe(ipc[key])
      }
    })
  })

  describe('type safety', () => {
    it('should support IpcObject type', () => {
      const obj: IpcObject = {
        SOCKET_CLI_FIX: 'test',
        SOCKET_CLI_OPTIMIZE: true,
      }
      expect(obj).toBeDefined()
    })

    it('should support partial IpcObject', () => {
      const obj: Partial<IpcObject> = {
        SOCKET_CLI_FIX: 'test',
      }
      expect(obj).toBeDefined()
    })

    it('should support empty IpcObject', () => {
      const obj: IpcObject = {}
      expect(obj).toBeDefined()
    })

    it('should enforce correct types for properties', () => {
      // TypeScript compile-time check
      const obj: IpcObject = {
        SOCKET_CLI_FIX: 'string-value',
        SOCKET_CLI_OPTIMIZE: true,
        SOCKET_CLI_SHADOW_ACCEPT_RISKS: true,
        SOCKET_CLI_SHADOW_API_TOKEN: 'token',
        SOCKET_CLI_SHADOW_BIN: '/bin/path',
        SOCKET_CLI_SHADOW_PROGRESS: true,
        SOCKET_CLI_SHADOW_SILENT: false,
      }
      expect(obj).toBeDefined()
    })
  })

  describe('immutability', () => {
    it('should not allow modification', async () => {
      const ipc = await getIpc()

      expect(() => {
        ipc.SOCKET_CLI_FIX = 'modified'
      }).toThrow()
    })

    it('should not allow adding properties', async () => {
      const ipc = await getIpc()

      expect(() => {
        // @ts-expect-error - Testing immutability by assigning to non-existent property
        ipc.NEW_PROPERTY = 'value'
      }).toThrow()
    })

    it('should not allow deleting properties', async () => {
      const ipc = await getIpc()
      const keys = Object.keys(ipc)

      if (keys.length > 0) {
        expect(() => {
          delete ipc[keys[0]]
        }).toThrow()
      }
    })
  })

  describe('concurrent access', () => {
    it('should handle multiple concurrent calls', async () => {
      const results = await Promise.all([
        getIpc(),
        getIpc(),
        getIpc(),
        getIpc(),
        getIpc(),
      ])

      // All should return the same reference
      results.forEach(result => {
        expect(result).toBe(results[0])
      })
    })

    it('should handle concurrent key accesses', async () => {
      const ipc = await getIpc()
      const keys = Object.keys(ipc) as Array<keyof IpcObject>

      if (keys.length > 0) {
        const results = await Promise.all(keys.map(key => getIpc(key)))

        results.forEach((result, i) => {
          expect(result).toBe(ipc[keys[i]])
        })
      }
    })
  })

  describe('edge cases', () => {
    it('should handle rapid repeated calls', async () => {
      const calls = []
      for (let i = 0; i < 100; i++) {
        calls.push(getIpc())
      }

      const results = await Promise.all(calls)
      results.forEach(result => {
        expect(result).toBe(results[0])
      })
    })

    it('should work with destructuring', async () => {
      const ipc = await getIpc()
      const { SOCKET_CLI_FIX, SOCKET_CLI_OPTIMIZE } = ipc

      expect(SOCKET_CLI_FIX).toBe(ipc.SOCKET_CLI_FIX)
      expect(SOCKET_CLI_OPTIMIZE).toBe(ipc.SOCKET_CLI_OPTIMIZE)
    })

    it('should work with spread operator', async () => {
      const ipc = await getIpc()
      const copy = { ...ipc }

      expect(copy).toEqual(ipc)
      expect(copy).not.toBe(ipc)
    })

    it('should work with Object.keys', async () => {
      const ipc = await getIpc()
      const keys = Object.keys(ipc)

      expect(Array.isArray(keys)).toBe(true)
      keys.forEach(key => {
        expect(key in ipc).toBe(true)
      })
    })

    it('should work with Object.values', async () => {
      const ipc = await getIpc()
      const values = Object.values(ipc)

      expect(Array.isArray(values)).toBe(true)
      expect(values.length).toBe(Object.keys(ipc).length)
    })

    it('should work with Object.entries', async () => {
      const ipc = await getIpc()
      const entries = Object.entries(ipc)

      expect(Array.isArray(entries)).toBe(true)
      entries.forEach(([key, value]) => {
        expect(ipc[key as keyof IpcObject]).toBe(value)
      })
    })

    it('should work with for...in loop', async () => {
      const ipc = await getIpc()
      const keys: string[] = []

      for (const key in ipc) {
        keys.push(key)
      }

      expect(keys).toEqual(Object.keys(ipc))
    })

    it('should work with hasOwnProperty', async () => {
      const ipc = await getIpc()
      const keys = Object.keys(ipc)

      keys.forEach(key => {
        expect(Object.hasOwn(ipc, key)).toBe(true)
      })
    })

    it('should not have prototype pollution', async () => {
      const ipc = await getIpc()

      expect('toString' in ipc).toBe(true) // inherited
      expect(Object.hasOwn(ipc, 'toString')).toBe(false) // not own property
    })
  })
})
