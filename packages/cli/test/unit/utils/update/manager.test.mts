/**
 * Unit tests for update manager utilities.
 *
 * Purpose:
 * Tests the update manager for npm/pnpm/yarn installations.
 *
 * Test Coverage:
 * - checkForUpdates function
 * - scheduleUpdateCheck function
 * - Parameter validation
 * - Cache handling
 *
 * Related Files:
 * - src/utils/update/manager.mts (implementation)
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

// Mock dlx manifest.
const mockDlxManifest = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}))
vi.mock('@socketsecurity/lib/dlx/manifest', () => ({
  dlxManifest: mockDlxManifest,
}))

// Mock checker.
const mockPerformUpdateCheck = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    current: '1.0.0',
    latest: '2.0.0',
    updateAvailable: true,
  }),
)
vi.mock('../../../../src/utils/update/checker.mts', () => ({
  checkForUpdates: mockPerformUpdateCheck,
}))

// Mock notifier.
const mockShowUpdateNotification = vi.hoisted(() => vi.fn())
const mockScheduleExitNotification = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/utils/update/notifier.mts', () => ({
  showUpdateNotification: mockShowUpdateNotification,
  scheduleExitNotification: mockScheduleExitNotification,
}))

// Mock SEA detect.
const mockIsSeaBinary = vi.hoisted(() => vi.fn(() => false))
vi.mock('../../../../src/utils/sea/detect.mts', () => ({
  isSeaBinary: mockIsSeaBinary,
}))

import {
  checkForUpdates,
  scheduleUpdateCheck,
} from '../../../../src/utils/update/manager.mts'

describe('update manager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDlxManifest.get.mockReturnValue(undefined)
    mockDlxManifest.set.mockResolvedValue(undefined)
    mockIsSeaBinary.mockReturnValue(false)
    mockPerformUpdateCheck.mockResolvedValue({
      current: '1.0.0',
      latest: '2.0.0',
      updateAvailable: true,
    })
  })

  describe('checkForUpdates', () => {
    describe('parameter validation', () => {
      it('returns false for empty package name', async () => {
        const result = await checkForUpdates({
          name: '',
          version: '1.0.0',
        })

        expect(result).toBe(false)
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Package name must be a non-empty string',
        )
      })

      it('returns false for empty version', async () => {
        const result = await checkForUpdates({
          name: 'socket',
          version: '',
        })

        expect(result).toBe(false)
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Current version must be a non-empty string',
        )
      })

      it('returns false for negative TTL', async () => {
        const result = await checkForUpdates({
          name: 'socket',
          version: '1.0.0',
          ttl: -1,
        })

        expect(result).toBe(false)
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'TTL must be a non-negative number',
        )
      })

      it('warns about invalid auth info but continues', async () => {
        await checkForUpdates({
          name: 'socket',
          version: '1.0.0',
          authInfo: { token: '', type: '' },
        })

        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Invalid auth info'),
        )
      })

      it('handles empty registry URL without warning', async () => {
        // Empty string is treated as "use default", not invalid.
        await checkForUpdates({
          name: 'socket',
          version: '1.0.0',
          registryUrl: '',
        })

        // Should proceed without warning about registry URL.
        expect(mockPerformUpdateCheck).toHaveBeenCalled()
      })
    })

    describe('cache handling', () => {
      it('uses fresh cache and skips fetch', async () => {
        // Set up fresh cache.
        mockDlxManifest.get.mockReturnValue({
          timestampFetch: Date.now() - 1000, // 1 second ago (fresh).
          version: '1.0.0',
        })

        const result = await checkForUpdates({
          name: 'socket',
          version: '1.0.0',
          ttl: 60_000, // 1 minute.
        })

        expect(result).toBe(false) // Same version.
        expect(mockPerformUpdateCheck).not.toHaveBeenCalled()
      })

      it('fetches when cache is stale', async () => {
        // Set up stale cache.
        mockDlxManifest.get.mockReturnValue({
          timestampFetch: Date.now() - 120_000, // 2 minutes ago (stale).
          version: '1.0.0',
        })

        await checkForUpdates({
          name: 'socket',
          version: '1.0.0',
          ttl: 60_000, // 1 minute.
        })

        expect(mockPerformUpdateCheck).toHaveBeenCalled()
      })

      it('fetches when no cache exists', async () => {
        mockDlxManifest.get.mockReturnValue(undefined)

        await checkForUpdates({
          name: 'socket',
          version: '1.0.0',
        })

        expect(mockPerformUpdateCheck).toHaveBeenCalled()
      })

      it('updates cache after successful fetch', async () => {
        mockDlxManifest.get.mockReturnValue(undefined)

        await checkForUpdates({
          name: 'socket',
          version: '1.0.0',
        })

        expect(mockDlxManifest.set).toHaveBeenCalledWith(
          'socket@1.0.0',
          expect.objectContaining({
            version: '2.0.0',
          }),
        )
      })
    })

    describe('notifications', () => {
      it('shows immediate notification when update available', async () => {
        mockDlxManifest.get.mockReturnValue(undefined)

        await checkForUpdates({
          name: 'socket',
          version: '1.0.0',
          immediate: true,
        })

        expect(mockShowUpdateNotification).toHaveBeenCalledWith({
          name: 'socket',
          current: '1.0.0',
          latest: '2.0.0',
        })
      })

      it('schedules exit notification when not immediate', async () => {
        mockDlxManifest.get.mockReturnValue(undefined)

        await checkForUpdates({
          name: 'socket',
          version: '1.0.0',
          immediate: false,
        })

        expect(mockScheduleExitNotification).toHaveBeenCalledWith({
          name: 'socket',
          current: '1.0.0',
          latest: '2.0.0',
        })
      })

      it('does not notify when no update available', async () => {
        mockPerformUpdateCheck.mockResolvedValue({
          current: '1.0.0',
          latest: '1.0.0',
          updateAvailable: false,
        })

        await checkForUpdates({
          name: 'socket',
          version: '1.0.0',
        })

        expect(mockShowUpdateNotification).not.toHaveBeenCalled()
        expect(mockScheduleExitNotification).not.toHaveBeenCalled()
      })
    })

    describe('error handling', () => {
      it('uses cached version when fetch fails', async () => {
        mockDlxManifest.get.mockReturnValue({
          timestampFetch: Date.now() - 120_000, // Stale.
          version: '1.5.0',
        })
        mockPerformUpdateCheck.mockRejectedValue(new Error('Network error'))

        const result = await checkForUpdates({
          name: 'socket',
          version: '1.0.0',
          ttl: 60_000,
        })

        expect(result).toBe(true) // 1.0.0 !== 1.5.0.
      })

      it('returns false when fetch fails and no cache', async () => {
        mockDlxManifest.get.mockReturnValue(undefined)
        mockPerformUpdateCheck.mockRejectedValue(new Error('Network error'))

        const result = await checkForUpdates({
          name: 'socket',
          version: '1.0.0',
        })

        expect(result).toBe(false)
        expect(mockLogger.log).toHaveBeenCalledWith(
          'No version information available',
        )
      })

      it('handles cache access errors', async () => {
        mockDlxManifest.get.mockImplementation(() => {
          throw new Error('Cache read error')
        })

        // Should not throw.
        const result = await checkForUpdates({
          name: 'socket',
          version: '1.0.0',
        })

        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Failed to access cache'),
        )
        // Should still try to fetch.
        expect(mockPerformUpdateCheck).toHaveBeenCalled()
        expect(result).toBe(true)
      })
    })
  })

  describe('scheduleUpdateCheck', () => {
    it('skips update check for SEA binaries', async () => {
      mockIsSeaBinary.mockReturnValue(true)

      await scheduleUpdateCheck({
        name: 'socket',
        version: '1.0.0',
      })

      expect(mockPerformUpdateCheck).not.toHaveBeenCalled()
    })

    it('performs update check for npm installations', async () => {
      mockIsSeaBinary.mockReturnValue(false)

      await scheduleUpdateCheck({
        name: 'socket',
        version: '1.0.0',
      })

      expect(mockPerformUpdateCheck).toHaveBeenCalled()
    })

    it('sets immediate to false', async () => {
      mockIsSeaBinary.mockReturnValue(false)
      mockDlxManifest.get.mockReturnValue(undefined)

      await scheduleUpdateCheck({
        name: 'socket',
        version: '1.0.0',
        immediate: true, // Should be overridden.
      })

      // Should schedule exit notification, not show immediately.
      expect(mockScheduleExitNotification).toHaveBeenCalled()
      expect(mockShowUpdateNotification).not.toHaveBeenCalled()
    })

    it('handles errors silently', async () => {
      mockIsSeaBinary.mockReturnValue(false)
      mockPerformUpdateCheck.mockRejectedValue(new Error('Fatal error'))

      // Should not throw.
      await expect(
        scheduleUpdateCheck({
          name: 'socket',
          version: '1.0.0',
        }),
      ).resolves.not.toThrow()

      // When fetch fails and no cache, logs about no version info.
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('No version information available'),
      )
    })
  })
})
