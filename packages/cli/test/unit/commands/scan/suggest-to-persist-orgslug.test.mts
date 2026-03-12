/**
 * Unit tests for organization slug persistence suggestion.
 *
 * Purpose:
 * Tests the prompt for persisting organization slug as default.
 *
 * Test Coverage:
 * - suggestToPersistOrgSlug function
 * - Config reading
 * - User selection handling
 * - Config update handling
 *
 * Related Files:
 * - src/commands/scan/suggest-to-persist-orgslug.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock logger.
const mockLogger = vi.hoisted(() => ({
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  fail: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
}))
vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))

// Mock select prompt.
const mockSelect = vi.hoisted(() => vi.fn())
vi.mock('@socketsecurity/lib/stdio/prompts', () => ({
  select: mockSelect,
}))

// Mock config.
const mockGetConfigValue = vi.hoisted(() => vi.fn())
const mockUpdateConfigValue = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/utils/config.mts', () => ({
  getConfigValue: mockGetConfigValue,
  updateConfigValue: mockUpdateConfigValue,
}))

import { suggestToPersistOrgSlug } from '../../../../src/commands/scan/suggest-to-persist-orgslug.mts'

describe('suggest-to-persist-orgslug', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('suggestToPersistOrgSlug', () => {
    it('returns early when config read fails', async () => {
      mockGetConfigValue.mockReturnValue({
        ok: false,
        message: 'Config read error',
      })

      await suggestToPersistOrgSlug('my-org')

      expect(mockSelect).not.toHaveBeenCalled()
    })

    it('returns early when skipAskToPersistDefaultOrg is true', async () => {
      mockGetConfigValue.mockReturnValue({
        ok: true,
        data: true,
      })

      await suggestToPersistOrgSlug('my-org')

      expect(mockSelect).not.toHaveBeenCalled()
    })

    it('prompts user when skipAskToPersistDefaultOrg is false', async () => {
      mockGetConfigValue.mockReturnValue({
        ok: true,
        data: false,
      })
      mockSelect.mockResolvedValue('no')

      await suggestToPersistOrgSlug('my-org')

      expect(mockSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('my-org'),
        }),
      )
    })

    it('updates default org when user selects yes', async () => {
      mockGetConfigValue.mockReturnValue({
        ok: true,
        data: false,
      })
      mockSelect.mockResolvedValue('yes')
      mockUpdateConfigValue.mockReturnValue({ ok: true })

      await suggestToPersistOrgSlug('my-org')

      expect(mockUpdateConfigValue).toHaveBeenCalledWith('defaultOrg', 'my-org')
      expect(mockLogger.success).toHaveBeenCalledWith(
        'Updated default org config to:',
        'my-org',
      )
    })

    it('logs error when updating default org fails', async () => {
      mockGetConfigValue.mockReturnValue({
        ok: true,
        data: false,
      })
      mockSelect.mockResolvedValue('yes')
      mockUpdateConfigValue.mockReturnValue({
        ok: false,
        cause: 'Write error',
      })

      await suggestToPersistOrgSlug('my-org')

      expect(mockLogger.fail).toHaveBeenCalledWith(
        expect.stringContaining('Failed to update default org'),
        'Write error',
      )
    })

    it('disables future prompts when user selects sush', async () => {
      mockGetConfigValue.mockReturnValue({
        ok: true,
        data: false,
      })
      mockSelect.mockResolvedValue('sush')
      mockUpdateConfigValue.mockReturnValue({ ok: true })

      await suggestToPersistOrgSlug('my-org')

      expect(mockUpdateConfigValue).toHaveBeenCalledWith(
        'skipAskToPersistDefaultOrg',
        true,
      )
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Default org not changed. Will not ask to persist again.',
      )
    })

    it('logs error when disabling future prompts fails', async () => {
      mockGetConfigValue.mockReturnValue({
        ok: true,
        data: false,
      })
      mockSelect.mockResolvedValue('sush')
      mockUpdateConfigValue.mockReturnValue({
        ok: false,
        cause: 'Permission denied',
      })

      await suggestToPersistOrgSlug('my-org')

      expect(mockLogger.fail).toHaveBeenCalledWith(
        expect.stringContaining('Failed to store preference'),
      )
    })

    it('does nothing when user selects no', async () => {
      mockGetConfigValue.mockReturnValue({
        ok: true,
        data: false,
      })
      mockSelect.mockResolvedValue('no')

      await suggestToPersistOrgSlug('my-org')

      expect(mockUpdateConfigValue).not.toHaveBeenCalled()
      expect(mockLogger.success).not.toHaveBeenCalled()
      expect(mockLogger.info).not.toHaveBeenCalled()
    })
  })
})
