/**
 * Unit tests for Coana scan ID extraction.
 *
 * Purpose:
 * Tests the extractTier1ReachabilityScanId function.
 *
 * Test Coverage:
 * - Valid scan ID extraction
 * - Missing file handling
 * - Invalid JSON handling
 * - Missing field handling
 *
 * Related Files:
 * - utils/coana/extract-scan-id.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies.
const mockReadJsonSync = vi.hoisted(() => vi.fn())

vi.mock('@socketsecurity/lib/fs', () => ({
  readJsonSync: mockReadJsonSync,
}))

import { extractTier1ReachabilityScanId } from '../../../../src/utils/coana/extract-scan-id.mts'

describe('extract-scan-id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('extractTier1ReachabilityScanId', () => {
    it('extracts scan ID from valid JSON file', () => {
      mockReadJsonSync.mockReturnValue({
        tier1ReachabilityScanId: 'scan-123',
      })

      const result = extractTier1ReachabilityScanId('/path/to/socket-facts.json')

      expect(result).toBe('scan-123')
      expect(mockReadJsonSync).toHaveBeenCalledWith('/path/to/socket-facts.json', {
        throws: false,
      })
    })

    it('returns undefined for missing file', () => {
      mockReadJsonSync.mockReturnValue(null)

      const result = extractTier1ReachabilityScanId('/path/to/missing.json')

      expect(result).toBeUndefined()
    })

    it('returns undefined for non-object JSON', () => {
      mockReadJsonSync.mockReturnValue('not an object')

      const result = extractTier1ReachabilityScanId('/path/to/file.json')

      expect(result).toBeUndefined()
    })

    it('returns undefined when tier1ReachabilityScanId is missing', () => {
      mockReadJsonSync.mockReturnValue({
        otherField: 'value',
      })

      const result = extractTier1ReachabilityScanId('/path/to/file.json')

      expect(result).toBeUndefined()
    })

    it('returns undefined for null scan ID', () => {
      mockReadJsonSync.mockReturnValue({
        tier1ReachabilityScanId: null,
      })

      const result = extractTier1ReachabilityScanId('/path/to/file.json')

      expect(result).toBeUndefined()
    })

    it('returns undefined for empty string scan ID', () => {
      mockReadJsonSync.mockReturnValue({
        tier1ReachabilityScanId: '',
      })

      const result = extractTier1ReachabilityScanId('/path/to/file.json')

      expect(result).toBeUndefined()
    })

    it('returns undefined for whitespace-only scan ID', () => {
      mockReadJsonSync.mockReturnValue({
        tier1ReachabilityScanId: '   ',
      })

      const result = extractTier1ReachabilityScanId('/path/to/file.json')

      expect(result).toBeUndefined()
    })

    it('trims whitespace from scan ID', () => {
      mockReadJsonSync.mockReturnValue({
        tier1ReachabilityScanId: '  scan-456  ',
      })

      const result = extractTier1ReachabilityScanId('/path/to/file.json')

      expect(result).toBe('scan-456')
    })

    it('converts numeric scan ID to string', () => {
      mockReadJsonSync.mockReturnValue({
        tier1ReachabilityScanId: 12345,
      })

      const result = extractTier1ReachabilityScanId('/path/to/file.json')

      expect(result).toBe('12345')
    })
  })
})
