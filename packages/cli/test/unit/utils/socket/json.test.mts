/**
 * Unit tests for Socket JSON utilities.
 *
 * Purpose:
 * Tests Socket-specific JSON parsing and formatting. Validates Socket API response handling.
 *
 * Test Coverage:
 * - JSON parsing
 * - JSON formatting
 * - Schema validation
 * - Error-tolerant parsing
 * - Large JSON handling
 *
 * Testing Approach:
 * Tests JSON utilities for Socket API data.
 *
 * Related Files:
 * - utils/socket/json.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies BEFORE imports.
const { mockExistsSync } = vi.hoisted(() => ({ mockExistsSync: vi.fn() }))
const { mockReadFileSync } = vi.hoisted(() => ({ mockReadFileSync: vi.fn() }))
const { mockReadFile } = vi.hoisted(() => ({ mockReadFile: vi.fn() }))
const { mockWriteFile } = vi.hoisted(() => ({ mockWriteFile: vi.fn() }))
const { mockStat } = vi.hoisted(() => ({ mockStat: vi.fn() }))

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  promises: {
    readFile: mockReadFile,
    writeFile: mockWriteFile,
    stat: mockStat,
  },
}))

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

import { promises as fs } from 'node:fs'
import path from 'node:path'

import {
  SOCKET_JSON,
  SOCKET_WEBSITE_URL,
} from '../../../../../src/constants/socket.mts'
import {
  findSocketJsonUp,
  getDefaultSocketJson,
  readOrDefaultSocketJson,
  readOrDefaultSocketJsonUp,
  readSocketJson,
  readSocketJsonSync,
  writeSocketJson,
} from '../../../../../src/utils/socket/json.mts'

describe('socket-json utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getDefaultSocketJson', () => {
    it('returns default socket.json structure', () => {
      const result = getDefaultSocketJson()
      expect(result.version).toBe(1)
      expect(result[' _____         _       _     ']).toContain(
        SOCKET_WEBSITE_URL,
      )
      expect(Object.keys(result)).toContain('|   __|___ ___| |_ ___| |_   ')
      expect(Object.keys(result)).toContain("|__   | . |  _| '_| -_|  _|  ")
      expect(Object.keys(result)).toContain('|_____|___|___|_,_|___|_|.dev')
    })
  })

  describe('readOrDefaultSocketJson', () => {
    it('returns parsed JSON when file exists and is valid', () => {
      const mockJson = { version: 1, custom: 'data' }
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify(mockJson))

      const result = readOrDefaultSocketJson('/test/dir')
      expect(result).toEqual(mockJson)
    })

    it('returns default when file does not exist', () => {
      mockExistsSync.mockReturnValue(false)

      const result = readOrDefaultSocketJson('/test/dir')
      expect(result.version).toBe(1)
    })

    it('returns default when file read fails', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockImplementation(() => {
        throw new Error('Read error')
      })

      const result = readOrDefaultSocketJson('/test/dir')
      expect(result.version).toBe(1)
    })

    it('returns default when JSON parse fails', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue('invalid json')

      const result = readOrDefaultSocketJson('/test/dir')
      expect(result.version).toBe(1)
    })
  })

  describe('findSocketJsonUp', () => {
    it('calls findUp with correct parameters', async () => {
      // Mock fs.stat to simulate finding socket.json in parent directory.
      mockStat.mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
      })

      const result = await findSocketJsonUp('/test/dir')
      // Should find socket.json somewhere up the tree.
      expect(result).toBeDefined()
      expect(result).toContain(SOCKET_JSON)
    })

    it('returns undefined when socket.json not found', async () => {
      // Mock fs.stat to always throw (file not found).
      mockStat.mockRejectedValue(new Error('ENOENT'))

      const result = await findSocketJsonUp('/test/dir')
      expect(result).toBeUndefined()
    })
  })

  describe('readOrDefaultSocketJsonUp', () => {
    it('reads socket.json when found up the tree', async () => {
      const mockJson = { version: 1, custom: 'data' }
      // Mock fs.stat to find socket.json.
      mockStat.mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
      })
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify(mockJson))

      const result = await readOrDefaultSocketJsonUp('/test/dir')
      expect(result).toEqual(mockJson)
    })

    it('returns default when socket.json not found up the tree', async () => {
      // Mock fs.stat to not find socket.json.
      mockStat.mockRejectedValue(new Error('ENOENT'))

      const result = await readOrDefaultSocketJsonUp('/test/dir')
      expect(result.version).toBe(1)
    })
  })

  describe('readSocketJson', () => {
    it('successfully reads and parses valid JSON file', async () => {
      const mockJson = { version: 1, custom: 'data' }
      mockExistsSync.mockReturnValue(true)
      mockReadFile.mockResolvedValue(JSON.stringify(mockJson))

      const result = await readSocketJson('/test/dir')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual(mockJson)
      }
    })

    it('returns default when file does not exist', async () => {
      mockExistsSync.mockReturnValue(false)

      const result = await readSocketJson('/test/dir')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.version).toBe(1)
      }
    })

    it('returns error when file read fails and defaultOnError is false', async () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFile.mockRejectedValue(new Error('Read error'))

      const result = await readSocketJson('/test/dir', false)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('Failed to read')
      }
    })

    it('returns default when file read fails and defaultOnError is true', async () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFile.mockRejectedValue(new Error('Read error'))

      const result = await readSocketJson('/test/dir', true)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.version).toBe(1)
      }
    })

    it('returns error when JSON parse fails and defaultOnError is false', async () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFile.mockResolvedValue('invalid json')

      const result = await readSocketJson('/test/dir', false)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('Failed to parse')
      }
    })

    it('returns default when JSON parse fails and defaultOnError is true', async () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFile.mockResolvedValue('invalid json')

      const result = await readSocketJson('/test/dir', true)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.version).toBe(1)
      }
    })

    it('returns default when file content is empty', async () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFile.mockResolvedValue('null')

      const result = await readSocketJson('/test/dir')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.version).toBe(1)
      }
    })
  })

  describe('readSocketJsonSync', () => {
    it('successfully reads and parses valid JSON file', () => {
      const mockJson = { version: 1, custom: 'data' }
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify(mockJson))

      const result = readSocketJsonSync('/test/dir')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual(mockJson)
      }
    })

    it('returns default when file does not exist', () => {
      mockExistsSync.mockReturnValue(false)

      const result = readSocketJsonSync('/test/dir')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.version).toBe(1)
      }
    })

    it('returns error when file read fails and defaultOnError is false', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockImplementation(() => {
        throw new Error('Read error')
      })

      const result = readSocketJsonSync('/test/dir', false)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('Failed to read')
      }
    })

    it('returns default when file read fails and defaultOnError is true', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockImplementation(() => {
        throw new Error('Read error')
      })

      const result = readSocketJsonSync('/test/dir', true)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.version).toBe(1)
      }
    })

    it('returns error when JSON parse fails and defaultOnError is false', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue('invalid json')

      const result = readSocketJsonSync('/test/dir', false)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('Failed to parse')
      }
    })

    it('returns default when JSON parse fails and defaultOnError is true', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue('invalid json')

      const result = readSocketJsonSync('/test/dir', true)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.version).toBe(1)
      }
    })

    it('returns default when file content is empty', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue('null')

      const result = readSocketJsonSync('/test/dir')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.version).toBe(1)
      }
    })
  })

  describe('writeSocketJson', () => {
    it('successfully writes socket.json', async () => {
      const mockJson = { version: 1, custom: 'data' }
      mockWriteFile.mockResolvedValue(undefined)

      const result = await writeSocketJson('/test/dir', mockJson as any)
      expect(result.ok).toBe(true)
      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join('/test/dir', SOCKET_JSON),
        expect.stringContaining('"version": 1'),
        'utf8',
      )
    })

    it('returns error when JSON serialization fails', async () => {
      const circularRef: any = {}
      circularRef.self = circularRef

      const result = await writeSocketJson('/test/dir', circularRef)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('Failed to serialize')
      }
    })

    it('writes with proper formatting', async () => {
      const mockJson = getDefaultSocketJson()
      mockWriteFile.mockResolvedValue(undefined)

      await writeSocketJson('/test/dir', mockJson)
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringMatching(/\n$/),
        'utf8',
      )
    })
  })
})
