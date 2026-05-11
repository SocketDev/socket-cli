/**
 * Unit tests for the word-overlap matcher.
 *
 * The handle-ask integration tests cover most of the public surface. This
 * file targets the edge-case branches that the integration runs don't reach.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockReadFile = vi.hoisted(() => vi.fn())
const mockGetHome = vi.hoisted(() => vi.fn())

vi.mock('node:fs', async importOriginal => {
  const actual: any = await importOriginal()
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: mockReadFile,
    },
  }
})

vi.mock('@socketsecurity/lib/env/home', () => ({
  getHome: mockGetHome,
}))

import {
  extractWords,
  normalizeQuery,
  wordOverlap,
  wordOverlapMatch,
} from '../../../../src/commands/ask/word-overlap-match.mts'

describe('word-overlap-match edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('normalizeQuery', () => {
    it('returns the lowercased query verbatim for plain input', () => {
      const result = normalizeQuery('Scan My Project')
      expect(result.toLowerCase()).toBe(result)
    })
  })

  describe('extractWords', () => {
    it('returns an empty array for whitespace-only input', () => {
      expect(extractWords('   ')).toEqual([])
    })

    it('filters out words shorter than 3 chars', () => {
      const words = extractWords('a b ab abc abcd')
      expect(words).not.toContain('a')
      expect(words).not.toContain('ab')
      expect(words).toContain('abc')
      expect(words).toContain('abcd')
    })
  })

  describe('wordOverlap', () => {
    it('returns 0 when both sides are empty', () => {
      expect(wordOverlap(new Set(), [])).toBe(0)
    })

    it('returns 1 for identical sets', () => {
      expect(wordOverlap(new Set(['a', 'b']), ['a', 'b'])).toBe(1)
    })
  })

  describe('wordOverlapMatch — empty-query early return (line 118)', () => {
    it('returns undefined when extractWords yields no tokens', async () => {
      // Provide an index so loadSemanticIndex succeeds, then pass a query
      // whose tokens are all <= 2 chars (filtered by extractWords).
      mockGetHome.mockReturnValue('/fake/home')
      mockReadFile.mockResolvedValue(
        JSON.stringify({
          commands: {
            fix: { words: ['fix', 'security'] },
          },
        }),
      )
      const result = await wordOverlapMatch('a b c')
      expect(result).toBeUndefined()
    })
  })
})
