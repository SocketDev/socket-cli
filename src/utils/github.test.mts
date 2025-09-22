import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheFetch, writeCache } from './github.mts'

// Mock the dependencies.
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  promises: {
    mkdir: vi.fn(),
  },
}))

vi.mock('@socketsecurity/registry/lib/fs', () => ({
  readJson: vi.fn(),
  safeStatsSync: vi.fn(),
  writeJson: vi.fn(),
}))

vi.mock('../constants.mts', () => {
  const kInternalsSymbol = Symbol.for('kInternalsSymbol')
  return {
    default: {
      githubCachePath: '/cache/github',
      ENV: {
        DISABLE_GITHUB_CACHE: false,
      },
      kInternalsSymbol,
      [kInternalsSymbol]: {
        getSentry: vi.fn(() => undefined),
      },
    },
  }
})

describe('github utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('writeCache', () => {
    it('creates cache directory if it does not exist', async () => {
      const { existsSync, promises: fs } = await import('node:fs')
      const { writeJson } = await import('@socketsecurity/registry/lib/fs')
      const mockExistsSync = vi.mocked(existsSync)
      const mockMkdir = vi.mocked(fs.mkdir)
      const mockWriteJson = vi.mocked(writeJson)

      mockExistsSync.mockReturnValue(false)

      await writeCache('test-key', { data: 'test' })

      expect(mockMkdir).toHaveBeenCalledWith(
        '/cache/github',
        { recursive: true },
      )
      expect(mockWriteJson).toHaveBeenCalledWith(
        '/cache/github/test-key.json',
        { data: 'test' },
      )
    })

    it('writes cache without creating directory if it exists', async () => {
      const { existsSync, promises: fs } = await import('node:fs')
      const { writeJson } = await import('@socketsecurity/registry/lib/fs')
      const mockExistsSync = vi.mocked(existsSync)
      const mockMkdir = vi.mocked(fs.mkdir)
      const mockWriteJson = vi.mocked(writeJson)

      mockExistsSync.mockReturnValue(true)

      await writeCache('another-key', { value: 123 })

      expect(mockMkdir).not.toHaveBeenCalled()
      expect(mockWriteJson).toHaveBeenCalledWith(
        '/cache/github/another-key.json',
        { value: 123 },
      )
    })
  })

  describe('cacheFetch', () => {
    it('returns cached data if not expired', async () => {
      const { readJson, safeStatsSync } = await import('@socketsecurity/registry/lib/fs')
      const mockReadJson = vi.mocked(readJson)
      const mockSafeStatsSync = vi.mocked(safeStatsSync)

      const cachedData = { cached: true, data: 'test' }
      mockSafeStatsSync.mockReturnValue({
        mtimeMs: Date.now() - 60000, // 1 minute ago.
      } as any)
      mockReadJson.mockResolvedValue(cachedData)

      const fetcher = vi.fn()
      const result = await cacheFetch('test-key', fetcher)

      expect(result).toEqual(cachedData)
      expect(fetcher).not.toHaveBeenCalled()
    })

    it('fetches fresh data if cache is expired', async () => {
      const { safeStatsSync, writeJson } = await import('@socketsecurity/registry/lib/fs')
      const mockSafeStatsSync = vi.mocked(safeStatsSync)
      const mockWriteJson = vi.mocked(writeJson)

      mockSafeStatsSync.mockReturnValue({
        mtimeMs: Date.now() - 400000, // 6+ minutes ago.
      } as any)

      const freshData = { fresh: true, data: 'new' }
      const fetcher = vi.fn().mockResolvedValue(freshData)

      const result = await cacheFetch('expired-key', fetcher)

      expect(result).toEqual(freshData)
      expect(fetcher).toHaveBeenCalled()
      expect(mockWriteJson).toHaveBeenCalled()
    })

    it('fetches fresh data if no cache exists', async () => {
      const { safeStatsSync, writeJson } = await import('@socketsecurity/registry/lib/fs')
      const mockSafeStatsSync = vi.mocked(safeStatsSync)
      const mockWriteJson = vi.mocked(writeJson)

      mockSafeStatsSync.mockReturnValue(undefined)

      const freshData = { fresh: true }
      const fetcher = vi.fn().mockResolvedValue(freshData)

      const result = await cacheFetch('no-cache-key', fetcher)

      expect(result).toEqual(freshData)
      expect(fetcher).toHaveBeenCalled()
      expect(mockWriteJson).toHaveBeenCalled()
    })

    it('bypasses cache when DISABLE_GITHUB_CACHE is true', async () => {
      const kInternalsSymbol = Symbol.for('kInternalsSymbol')
      vi.doMock('../constants.mts', () => ({
        default: {
          githubCachePath: '/cache/github',
          ENV: {
            DISABLE_GITHUB_CACHE: true,
          },
          kInternalsSymbol,
          [kInternalsSymbol]: {
            getSentry: vi.fn(() => undefined),
          },
        },
      }))

      const fetcher = vi.fn().mockResolvedValue({ direct: true })

      // Re-import to get new mock.
      const { cacheFetch: cacheFetchDisabled } = await import('./github.mts')
      const result = await cacheFetchDisabled('key', fetcher)

      expect(result).toEqual({ direct: true })
      expect(fetcher).toHaveBeenCalled()

      // Reset mock.
      vi.doUnmock('../constants.mts')
    })
  })
})
