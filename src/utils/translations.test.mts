import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'

import { getTranslations } from './translations.mts'

// Mock node:module.
vi.mock('node:module', () => ({
  createRequire: vi.fn(() => vi.fn()),
}))

// Mock constants.
vi.mock('../constants.mts', () => ({
  default: {
    rootPath: '/mock/root/path',
  },
}))

describe('translations utilities', () => {
  let mockRequire: ReturnType<typeof vi.fn>
  let mockTranslations: Record<string, any>

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset the module-level cache by clearing the module from cache.
    vi.resetModules()

    mockTranslations = {
      messages: {
        hello: 'Hello',
        goodbye: 'Goodbye',
      },
      errors: {
        notFound: 'Not found',
        unauthorized: 'Unauthorized',
      },
    }

    mockRequire = vi.fn(() => mockTranslations)
    vi.mocked(createRequire).mockReturnValue(mockRequire)
  })

  describe('getTranslations', () => {
    it('loads translations from the correct path', async () => {
      // Re-import to get fresh module with reset cache.
      const { getTranslations: getTranslationsFresh } = await import(
        './translations.mts'
      )

      const result = getTranslationsFresh()

      expect(mockRequire).toHaveBeenCalledWith(
        path.join('/mock/root/path', 'translations.json'),
      )
      expect(result).toBe(mockTranslations)
    })

    it('caches translations after first load', async () => {
      // Re-import to get fresh module with reset cache.
      const { getTranslations: getTranslationsFresh } = await import(
        './translations.mts'
      )

      const result1 = getTranslationsFresh()
      const result2 = getTranslationsFresh()
      const result3 = getTranslationsFresh()

      // Should only require once.
      expect(mockRequire).toHaveBeenCalledTimes(1)
      // Should return the same object.
      expect(result1).toBe(result2)
      expect(result2).toBe(result3)
      expect(result1).toBe(mockTranslations)
    })

    it('returns the translations object', async () => {
      // Re-import to get fresh module with reset cache.
      const { getTranslations: getTranslationsFresh } = await import(
        './translations.mts'
      )

      const result = getTranslationsFresh()

      expect(result).toHaveProperty('messages')
      expect(result).toHaveProperty('errors')
      expect(result.messages.hello).toBe('Hello')
      expect(result.errors.notFound).toBe('Not found')
    })

    it('uses createRequire with import.meta.url', async () => {
      // Re-import to get fresh module with reset cache.
      const { getTranslations: getTranslationsFresh } = await import(
        './translations.mts'
      )

      getTranslationsFresh()

      expect(createRequire).toHaveBeenCalledWith(
        expect.stringContaining('.mts'),
      )
    })

    it('handles empty translations object', async () => {
      mockTranslations = {}
      mockRequire = vi.fn(() => mockTranslations)
      vi.mocked(createRequire).mockReturnValue(mockRequire)

      // Re-import to get fresh module with reset cache.
      const { getTranslations: getTranslationsFresh } = await import(
        './translations.mts'
      )

      const result = getTranslationsFresh()

      expect(result).toEqual({})
    })

    it('handles complex nested translations', async () => {
      mockTranslations = {
        level1: {
          level2: {
            level3: {
              message: 'Deeply nested message',
            },
          },
        },
        arrays: ['item1', 'item2'],
      }
      mockRequire = vi.fn(() => mockTranslations)
      vi.mocked(createRequire).mockReturnValue(mockRequire)

      // Re-import to get fresh module with reset cache.
      const { getTranslations: getTranslationsFresh } = await import(
        './translations.mts'
      )

      const result = getTranslationsFresh()

      expect(result.level1.level2.level3.message).toBe('Deeply nested message')
      expect(result.arrays).toEqual(['item1', 'item2'])
    })
  })
})
