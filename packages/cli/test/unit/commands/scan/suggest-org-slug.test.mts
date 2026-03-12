/**
 * Unit tests for organization slug suggestion utility.
 *
 * Purpose:
 * Tests the organization slug suggestion prompt.
 *
 * Test Coverage:
 * - suggestOrgSlug function
 * - API failure handling
 * - User selection
 *
 * Related Files:
 * - src/commands/scan/suggest-org-slug.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock logger.
const mockLogger = vi.hoisted(() => ({
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  fail: vi.fn(),
  success: vi.fn(),
}))
vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))

// Mock select prompt.
const mockSelect = vi.hoisted(() => vi.fn())
vi.mock('@socketsecurity/lib/stdio/prompts', () => ({
  select: mockSelect,
}))

// Mock fetchOrganization.
const mockFetchOrganization = vi.hoisted(() => vi.fn())
vi.mock(
  '../../../../src/commands/organization/fetch-organization-list.mts',
  () => ({
    fetchOrganization: mockFetchOrganization,
  }),
)

import { suggestOrgSlug } from '../../../../src/commands/scan/suggest-org-slug.mts'

describe('suggest-org-slug', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('suggestOrgSlug', () => {
    it('returns undefined when API fails', async () => {
      mockFetchOrganization.mockResolvedValue({
        ok: false,
        message: 'Failed to fetch',
      })

      const result = await suggestOrgSlug()

      expect(result).toBeUndefined()
      expect(mockLogger.fail).toHaveBeenCalledWith(
        expect.stringContaining('Failed to lookup organization'),
      )
    })

    it('returns selected organization slug', async () => {
      mockFetchOrganization.mockResolvedValue({
        ok: true,
        data: {
          organizations: [
            { name: 'My Org', slug: 'my-org' },
            { name: 'Other Org', slug: 'other-org' },
          ],
        },
      })
      mockSelect.mockResolvedValue('my-org')

      const result = await suggestOrgSlug()

      expect(result).toBe('my-org')
      expect(mockSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Missing org name'),
        }),
      )
    })

    it('returns undefined when user selects No', async () => {
      mockFetchOrganization.mockResolvedValue({
        ok: true,
        data: {
          organizations: [{ name: 'My Org', slug: 'my-org' }],
        },
      })
      mockSelect.mockResolvedValue('')

      const result = await suggestOrgSlug()

      expect(result).toBeUndefined()
    })

    it('uses slug as name when name is not available', async () => {
      mockFetchOrganization.mockResolvedValue({
        ok: true,
        data: {
          organizations: [{ slug: 'my-slug' }],
        },
      })
      mockSelect.mockResolvedValue('my-slug')

      const result = await suggestOrgSlug()

      expect(result).toBe('my-slug')
      const callArg = mockSelect.mock.calls[0]![0] as {
        choices: Array<{ name: string }>
      }
      expect(callArg.choices[0]!.name).toContain('my-slug')
    })

    it('includes No option in choices', async () => {
      mockFetchOrganization.mockResolvedValue({
        ok: true,
        data: {
          organizations: [{ name: 'My Org', slug: 'my-org' }],
        },
      })
      mockSelect.mockResolvedValue('')

      await suggestOrgSlug()

      const callArg = mockSelect.mock.calls[0]![0] as {
        choices: Array<{ name: string; value: string }>
      }
      const noChoice = callArg.choices.find(c => c.name === 'No')
      expect(noChoice).toBeDefined()
      expect(noChoice!.value).toBe('')
    })
  })
})
