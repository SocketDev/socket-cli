import { existsSync, promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  findSocketJsonUp,
  getDefaultSocketJson,
  readOrDefaultSocketJson,
  readOrDefaultSocketJsonUp,
  readSocketJson,
  readSocketJsonSync,
  writeSocketJson,
} from './json.mts'
import { SOCKET_WEBSITE_URL } from '../../constants/socket.mts'
import { SOCKET_JSON } from '../../constants/shadow.mts'

// Mock dependencies.
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}))

vi.mock('./fs.mts', () => ({
  findUp: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
  },
}))

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
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockJson))

      const result = readOrDefaultSocketJson('/test/dir')
      expect(result).toEqual(mockJson)
    })

    it('returns default when file does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false)

      const result = readOrDefaultSocketJson('/test/dir')
      expect(result.version).toBe(1)
    })

    it('returns default when file read fails', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('Read error')
      })

      const result = readOrDefaultSocketJson('/test/dir')
      expect(result.version).toBe(1)
    })

    it('returns default when JSON parse fails', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('invalid json')

      const result = readOrDefaultSocketJson('/test/dir')
      expect(result.version).toBe(1)
    })
  })

  describe('findSocketJsonUp', () => {
    it('calls findUp with correct parameters', async () => {
      const { findUp } = await import('./fs.mts')
      vi.mocked(findUp).mockResolvedValue('/path/to/socket.json')

      const result = await findSocketJsonUp('/test/dir')
      expect(result).toBe('/path/to/socket.json')
      expect(findUp).toHaveBeenCalledWith(SOCKET_JSON, {
        onlyFiles: true,
        cwd: '/test/dir',
      })
    })

    it('returns undefined when socket.json not found', async () => {
      const { findUp } = await import('./fs.mts')
      vi.mocked(findUp).mockResolvedValue(undefined)

      const result = await findSocketJsonUp('/test/dir')
      expect(result).toBeUndefined()
    })
  })

  describe('readOrDefaultSocketJsonUp', () => {
    it('reads socket.json when found up the tree', async () => {
      const { findUp } = await import('./fs.mts')
      const mockJson = { version: 1, custom: 'data' }
      vi.mocked(findUp).mockResolvedValue('/parent/socket.json')
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockJson))

      const result = await readOrDefaultSocketJsonUp('/test/dir')
      expect(result).toEqual(mockJson)
    })

    it('returns default when socket.json not found up the tree', async () => {
      const { findUp } = await import('./fs.mts')
      vi.mocked(findUp).mockResolvedValue(undefined)

      const result = await readOrDefaultSocketJsonUp('/test/dir')
      expect(result.version).toBe(1)
    })
  })

  describe('readSocketJson', () => {
    it('successfully reads and parses valid JSON file', async () => {
      const mockJson = { version: 1, custom: 'data' }
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockJson))

      const result = await readSocketJson('/test/dir')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual(mockJson)
      }
    })

    it('returns default when file does not exist', async () => {
      vi.mocked(existsSync).mockReturnValue(false)

      const result = await readSocketJson('/test/dir')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.version).toBe(1)
      }
    })

    it('returns error when file read fails and defaultOnError is false', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(fs.readFile).mockRejectedValue(new Error('Read error'))

      const result = await readSocketJson('/test/dir', false)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('Failed to read')
      }
    })

    it('returns default when file read fails and defaultOnError is true', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(fs.readFile).mockRejectedValue(new Error('Read error'))

      const result = await readSocketJson('/test/dir', true)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.version).toBe(1)
      }
    })

    it('returns error when JSON parse fails and defaultOnError is false', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(fs.readFile).mockResolvedValue('invalid json')

      const result = await readSocketJson('/test/dir', false)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('Failed to parse')
      }
    })

    it('returns default when JSON parse fails and defaultOnError is true', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(fs.readFile).mockResolvedValue('invalid json')

      const result = await readSocketJson('/test/dir', true)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.version).toBe(1)
      }
    })

    it('returns default when file content is empty', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(fs.readFile).mockResolvedValue('null')

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
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockJson))

      const result = readSocketJsonSync('/test/dir')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual(mockJson)
      }
    })

    it('returns default when file does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false)

      const result = readSocketJsonSync('/test/dir')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.version).toBe(1)
      }
    })

    it('returns error when file read fails and defaultOnError is false', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('Read error')
      })

      const result = readSocketJsonSync('/test/dir', false)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('Failed to read')
      }
    })

    it('returns default when file read fails and defaultOnError is true', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('Read error')
      })

      const result = readSocketJsonSync('/test/dir', true)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.version).toBe(1)
      }
    })

    it('returns error when JSON parse fails and defaultOnError is false', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('invalid json')

      const result = readSocketJsonSync('/test/dir', false)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('Failed to parse')
      }
    })

    it('returns default when JSON parse fails and defaultOnError is true', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('invalid json')

      const result = readSocketJsonSync('/test/dir', true)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.version).toBe(1)
      }
    })

    it('returns default when file content is empty', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('null')

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
      vi.mocked(fs.writeFile).mockResolvedValue(undefined)

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
      vi.mocked(fs.writeFile).mockResolvedValue(undefined)

      await writeSocketJson('/test/dir', mockJson)
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringMatching(/\n$/),
        'utf8',
      )
    })
  })
})
