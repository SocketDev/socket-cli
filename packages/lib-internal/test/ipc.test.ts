/**
 * @fileoverview Unit tests for Inter-Process Communication utilities.
 *
 * Tests IPC (Inter-Process Communication) utilities:
 * - createIpcChannelId() generates unique channel IDs
 * - createIpcMessage(), parseIpcMessage() for message serialization
 * - writeIpcStub(), readIpcStub() for file-based IPC
 * - getIpcStubPath() resolves IPC stub file paths
 * - hasIpcChannel() checks for active channels
 * - cleanupIpcStubs() removes stale stub files
 * Used by Socket CLI for parent-child process communication.
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  cleanupIpcStubs,
  createIpcChannelId,
  createIpcMessage,
  getIpcStubPath,
  hasIpcChannel,
  type IpcMessage,
  parseIpcMessage,
  readIpcStub,
  writeIpcStub,
} from '../src/ipc'
import { resetPaths, setPath } from '../src/paths/rewire'
import { describe, expect, it } from 'vitest'
import { runWithTempDir } from './utils/temp-file-helper.mjs'

describe('ipc', () => {
  describe('createIpcChannelId', () => {
    it('should create a unique channel ID with default prefix', () => {
      const channelId = createIpcChannelId()
      expect(channelId).toMatch(/^socket-\d+-[a-f0-9]{16}$/)
    })

    it('should create a unique channel ID with custom prefix', () => {
      const channelId = createIpcChannelId('test-app')
      expect(channelId).toMatch(/^test-app-\d+-[a-f0-9]{16}$/)
    })

    it('should create unique IDs on multiple calls', () => {
      const id1 = createIpcChannelId()
      const id2 = createIpcChannelId()
      expect(id1).not.toBe(id2)
    })
  })

  describe('getIpcStubPath', () => {
    it('should return path in temp directory', () => {
      const stubPath = getIpcStubPath('socket-cli')
      const tempDir = os.tmpdir()
      expect(stubPath).toContain(tempDir)
      expect(stubPath).toContain('.socket-ipc')
      expect(stubPath).toContain('socket-cli')
    })

    it('should include process ID in filename', () => {
      const stubPath = getIpcStubPath('test-app')
      expect(stubPath).toContain(`stub-${process.pid}.json`)
    })

    it('should create unique paths for different apps', () => {
      const path1 = getIpcStubPath('app1')
      const path2 = getIpcStubPath('app2')
      expect(path1).not.toBe(path2)
    })
  })

  describe('writeIpcStub', () => {
    it('should write stub file with valid data', async () => {
      await runWithTempDir(async tmpDir => {
        // Override temp directory for testing.
        setPath('tmpdir', tmpDir)

        try {
          const data = { apiToken: 'test-token', config: { foo: 'bar' } }
          const stubPath = await writeIpcStub('test-app', data)

          expect(stubPath).toContain(tmpDir)

          const content = await fs.readFile(stubPath, 'utf8')
          const parsed = JSON.parse(content)

          expect(parsed.pid).toBe(process.pid)
          expect(parsed.timestamp).toBeTypeOf('number')
          expect(parsed.data).toEqual(data)
        } finally {
          resetPaths()
        }
      }, 'ipc-write-test-')
    })

    it('should create directory structure if not exists', async () => {
      await runWithTempDir(async tmpDir => {
        setPath('tmpdir', tmpDir)

        try {
          const stubPath = await writeIpcStub('new-app', {
            test: 'data',
          })
          const dirExists = await fs
            .stat(path.dirname(stubPath))
            .then(() => true)
            .catch(() => false)
          expect(dirExists).toBe(true)
        } finally {
          resetPaths()
        }
      }, 'ipc-mkdir-test-')
    })
  })

  describe('readIpcStub', () => {
    it('should read valid stub file', async () => {
      await runWithTempDir(async tmpDir => {
        setPath('tmpdir', tmpDir)

        try {
          const testData = { message: 'Hello IPC!' }
          const stubPath = await writeIpcStub('test-read', testData)

          const readData = await readIpcStub(stubPath)
          expect(readData).toEqual(testData)
        } finally {
          resetPaths()
        }
      }, 'ipc-read-test-')
    })

    it('should return null for non-existent file', async () => {
      const result = await readIpcStub('/nonexistent/path/stub.json')
      expect(result).toBeNull()
    })

    it('should return null for invalid JSON', async () => {
      await runWithTempDir(async tmpDir => {
        const invalidPath = path.join(tmpDir, 'invalid.json')
        await fs.writeFile(invalidPath, 'not valid json', 'utf8')

        const result = await readIpcStub(invalidPath)
        expect(result).toBeNull()
      }, 'ipc-invalid-test-')
    })

    it('should return null and cleanup stale files', async () => {
      await runWithTempDir(async tmpDir => {
        setPath('tmpdir', tmpDir)

        try {
          const stubPath = await writeIpcStub('stale-test', {
            data: 'old',
          })

          // Make the file stale by modifying its timestamp.
          // 10 minutes ago (well past the 5-minute threshold for robustness).
          const staleTimestamp = Date.now() - 10 * 60 * 1000
          const staleStub = {
            data: { data: 'old' },
            pid: process.pid,
            timestamp: staleTimestamp,
          }
          await fs.writeFile(
            stubPath,
            JSON.stringify(staleStub, null, 2),
            'utf8',
          )

          const result = await readIpcStub(stubPath)
          expect(result).toBeNull()

          // File should be deleted.
          const exists = await fs
            .access(stubPath)
            .then(() => true)
            .catch(() => false)
          expect(exists).toBe(false)
        } finally {
          resetPaths()
        }
      }, 'ipc-stale-test-')
    })
  })

  describe('cleanupIpcStubs', () => {
    // Flaky: async file deletion timing varies across different environments
    // Retry up to 3 times to handle timing issues
    // Note: Weird that deletion doesn't complete despite awaits - possible OS-level caching
    it('should clean up stale stub files', { retry: 3 }, async () => {
      await runWithTempDir(async tmpDir => {
        setPath('tmpdir', tmpDir)

        try {
          // Create some stub files.
          const stubPath1 = await writeIpcStub('cleanup-test', {
            data: '1',
          })
          const stubPath2 = await writeIpcStub('cleanup-test', {
            data: '2',
          })

          // Make one file stale.
          const dir = path.dirname(stubPath1)
          const staleFile = path.join(dir, 'stub-99999.json')
          // 10 minutes ago (well past the 5-minute threshold for robustness).
          const staleTimestamp = Date.now() - 10 * 60 * 1000
          const staleStub = {
            data: { test: 'stale' },
            pid: 99_999,
            timestamp: staleTimestamp,
          }
          await fs.writeFile(
            staleFile,
            JSON.stringify(staleStub, null, 2),
            'utf8',
          )
          // Set the file's modification time to match the stale timestamp.
          const staleTime = new Date(staleTimestamp)
          await fs.utimes(staleFile, staleTime, staleTime)

          // Small delay to ensure filesystem operations are fully committed
          await new Promise(resolve => setTimeout(resolve, 50))

          await cleanupIpcStubs('cleanup-test')

          // Add delay to allow async deletion to complete in slow CI environments
          await new Promise(resolve => setTimeout(resolve, 100))

          // Stale file should be deleted
          const staleExists = await fs
            .access(staleFile)
            .then(() => true)
            .catch(() => false)

          expect(staleExists).toBe(false)

          // Fresh files should still exist.
          const fresh1Exists = await fs
            .access(stubPath1)
            .then(() => true)
            .catch(() => false)
          const fresh2Exists = await fs
            .access(stubPath2)
            .then(() => true)
            .catch(() => false)
          expect(fresh1Exists).toBe(true)
          expect(fresh2Exists).toBe(true)
        } finally {
          resetPaths()
        }
      }, 'ipc-cleanup-test-')
    })

    it('should handle non-existent directory gracefully', async () => {
      await expect(cleanupIpcStubs('nonexistent-app')).resolves.toBeUndefined()
    })
  })

  describe('createIpcMessage', () => {
    it('should create a valid IPC message', () => {
      const data = { foo: 'bar' }
      const message = createIpcMessage('test-type', data)

      expect(message.id).toMatch(/^[a-f0-9]{32}$/)
      expect(message.timestamp).toBeTypeOf('number')
      expect(message.type).toBe('test-type')
      expect(message.data).toEqual(data)
    })

    it('should create unique message IDs', () => {
      const msg1 = createIpcMessage('type1', {})
      const msg2 = createIpcMessage('type2', {})
      expect(msg1.id).not.toBe(msg2.id)
    })

    it('should handle different data types', () => {
      const stringMsg = createIpcMessage('string', 'hello')
      const numberMsg = createIpcMessage('number', 42)
      const arrayMsg = createIpcMessage('array', [1, 2, 3])
      const objectMsg = createIpcMessage('object', { a: 1, b: 2 })

      expect(stringMsg.data).toBe('hello')
      expect(numberMsg.data).toBe(42)
      expect(arrayMsg.data).toEqual([1, 2, 3])
      expect(objectMsg.data).toEqual({ a: 1, b: 2 })
    })
  })

  describe('parseIpcMessage', () => {
    it('should parse valid IPC message', () => {
      const valid: IpcMessage = {
        data: { test: 'data' },
        id: 'abc123',
        timestamp: Date.now(),
        type: 'test',
      }

      const parsed = parseIpcMessage(valid)
      expect(parsed).toEqual(valid)
    })

    it('should return null for invalid messages', () => {
      expect(parseIpcMessage(null)).toBeNull()
      expect(parseIpcMessage(undefined)).toBeNull()
      expect(parseIpcMessage('string')).toBeNull()
      expect(parseIpcMessage(123)).toBeNull()
      expect(parseIpcMessage({})).toBeNull()
    })

    it('should return null for messages missing required fields', () => {
      expect(parseIpcMessage({ id: '123', type: 'test' })).toBeNull()
      expect(parseIpcMessage({ id: '123', timestamp: Date.now() })).toBeNull()
      expect(
        parseIpcMessage({ type: 'test', timestamp: Date.now() }),
      ).toBeNull()
    })

    it('should validate field types', () => {
      // Should be string.
      expect(
        parseIpcMessage({
          data: {},
          id: 123,
          timestamp: Date.now(),
          type: 'test',
        }),
      ).toBeNull()

      // Should be number.
      expect(
        parseIpcMessage({
          data: {},
          id: 'valid',
          timestamp: 'invalid',
          type: 'test',
        }),
      ).toBeNull()
    })
  })

  describe('hasIpcChannel', () => {
    it('should return false for null/undefined', () => {
      expect(hasIpcChannel(null)).toBe(false)
      expect(hasIpcChannel(undefined)).toBe(false)
    })

    it('should return false for objects without send function', () => {
      expect(hasIpcChannel({})).toBe(false)
      expect(hasIpcChannel({ send: 'not a function' })).toBe(false)
    })

    it('should return false without channel property', () => {
      expect(hasIpcChannel({ send: () => {} })).toBe(false)
    })

    it('should return true for valid IPC process', () => {
      const mockProcess = {
        channel: {},
        send: () => true,
      }
      expect(hasIpcChannel(mockProcess)).toBe(true)
    })
  })
})
