import { describe, expect, it, vi } from 'vitest'

import { extractTier1ReachabilityScanId } from '../../../../src/src/coana/extract-scan-id.mts'

// Mock @socketsecurity/lib/fs.
const mockReadJsonSync = vi.hoisted(() => vi.fn())

vi.mock('@socketsecurity/lib/fs', () => ({
  readJsonSync: mockReadJsonSync,
}))

describe('coana utilities', () => {
  describe('extractTier1ReachabilityScanId', () => {
    it('extracts scan ID from valid socket facts file', async () => {
      const { readJsonSync } = vi.mocked(await import('@socketsecurity/lib/fs'))
      mockReadJsonSync.mockReturnValue({
        tier1ReachabilityScanId: 'scan-123-abc',
        otherField: 'value',
      })

      const result = extractTier1ReachabilityScanId(
        '/path/to/socket-facts.json',
      )

      expect(result).toBe('scan-123-abc')
      expect(readJsonSync).toHaveBeenCalledWith('/path/to/socket-facts.json', {
        throws: false,
      })
    })

    it('returns undefined when tier1ReachabilityScanId is missing', async () => {
      const { readJsonSync } = vi.mocked(await import('@socketsecurity/lib/fs'))
      mockReadJsonSync.mockReturnValue({
        otherField: 'value',
      })

      const result = extractTier1ReachabilityScanId(
        '/path/to/socket-facts.json',
      )

      expect(result).toBeUndefined()
    })

    it('returns undefined when tier1ReachabilityScanId is empty string', async () => {
      const { readJsonSync } = vi.mocked(await import('@socketsecurity/lib/fs'))
      mockReadJsonSync.mockReturnValue({
        tier1ReachabilityScanId: '',
      })

      const result = extractTier1ReachabilityScanId(
        '/path/to/socket-facts.json',
      )

      expect(result).toBeUndefined()
    })

    it('returns undefined when tier1ReachabilityScanId is whitespace only', async () => {
      const { readJsonSync } = vi.mocked(await import('@socketsecurity/lib/fs'))
      mockReadJsonSync.mockReturnValue({
        tier1ReachabilityScanId: '   \t\n  ',
      })

      const result = extractTier1ReachabilityScanId(
        '/path/to/socket-facts.json',
      )

      expect(result).toBeUndefined()
    })

    it('trims whitespace from scan ID', async () => {
      const { readJsonSync } = vi.mocked(await import('@socketsecurity/lib/fs'))
      mockReadJsonSync.mockReturnValue({
        tier1ReachabilityScanId: '  scan-456-def  \n',
      })

      const result = extractTier1ReachabilityScanId(
        '/path/to/socket-facts.json',
      )

      expect(result).toBe('scan-456-def')
    })

    it('converts non-string values to string', async () => {
      const { readJsonSync } = vi.mocked(await import('@socketsecurity/lib/fs'))
      mockReadJsonSync.mockReturnValue({
        tier1ReachabilityScanId: 12345,
      })

      const result = extractTier1ReachabilityScanId(
        '/path/to/socket-facts.json',
      )

      expect(result).toBe('12345')
    })

    it('handles null tier1ReachabilityScanId', async () => {
      const { readJsonSync } = vi.mocked(await import('@socketsecurity/lib/fs'))
      mockReadJsonSync.mockReturnValue({
        tier1ReachabilityScanId: null,
      })

      const result = extractTier1ReachabilityScanId(
        '/path/to/socket-facts.json',
      )

      expect(result).toBeUndefined()
    })

    it('handles undefined tier1ReachabilityScanId', async () => {
      const { readJsonSync } = vi.mocked(await import('@socketsecurity/lib/fs'))
      mockReadJsonSync.mockReturnValue({
        tier1ReachabilityScanId: undefined,
      })

      const result = extractTier1ReachabilityScanId(
        '/path/to/socket-facts.json',
      )

      expect(result).toBeUndefined()
    })

    it('returns undefined when JSON parsing fails', async () => {
      const { readJsonSync } = vi.mocked(await import('@socketsecurity/lib/fs'))
      mockReadJsonSync.mockReturnValue(undefined)

      const result = extractTier1ReachabilityScanId('/path/to/invalid.json')

      expect(result).toBeUndefined()
    })

    it('returns undefined when readJsonSync returns null', async () => {
      const { readJsonSync } = vi.mocked(await import('@socketsecurity/lib/fs'))
      mockReadJsonSync.mockReturnValue(null)

      const result = extractTier1ReachabilityScanId('/path/to/null.json')

      expect(result).toBeUndefined()
    })

    it('handles boolean values', async () => {
      const { readJsonSync } = vi.mocked(await import('@socketsecurity/lib/fs'))
      mockReadJsonSync.mockReturnValue({
        tier1ReachabilityScanId: true,
      })

      const result = extractTier1ReachabilityScanId(
        '/path/to/socket-facts.json',
      )

      expect(result).toBe('true')
    })

    it('handles array values', async () => {
      const { readJsonSync } = vi.mocked(await import('@socketsecurity/lib/fs'))
      mockReadJsonSync.mockReturnValue({
        tier1ReachabilityScanId: ['scan', '123'],
      })

      const result = extractTier1ReachabilityScanId(
        '/path/to/socket-facts.json',
      )

      expect(result).toBe('scan,123')
    })

    it('handles object values', async () => {
      const { readJsonSync } = vi.mocked(await import('@socketsecurity/lib/fs'))
      mockReadJsonSync.mockReturnValue({
        tier1ReachabilityScanId: { id: 'scan-789' },
      })

      const result = extractTier1ReachabilityScanId(
        '/path/to/socket-facts.json',
      )

      expect(result).toBe('[object Object]')
    })
  })
})
