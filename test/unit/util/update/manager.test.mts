/**
 * Unit tests for update manager utilities.
 *
 * Purpose: Tests the update manager for npm/pnpm/yarn installations.
 *
 * Test Coverage: - scheduleUpdateCheck function - System-time-invalid cache
 * handling.
 *
 * Related Files: - src/util/update/manager.mts (implementation) -
 * manager-check-for-updates.test.mts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkForUpdates,
  scheduleUpdateCheck,
} from '../../../../src/util/update/manager.mts'

// Mock logger.
const mockLogger = vi.hoisted(() => ({
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  fail: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => mockLogger,
}))

// Mock dlx manifest.
const mockDlxManifest = vi.hoisted(() => ({
  getManifestEntry: vi.fn(),
  setPackageEntry: vi.fn(),
}))
vi.mock(
  import('@socketsecurity/lib-stable/dlx/manifest'),
  async importOriginal => ({
    ...(await importOriginal()),
    dlxManifest: mockDlxManifest,
  }),
)

// Mock checker.
const mockPerformUpdateCheck = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    current: '1.0.0',
    latest: '2.0.0',
    updateAvailable: true,
  }),
)
vi.mock(import('../../../../src/util/update/checker.mts'), () => ({
  checkForUpdates: mockPerformUpdateCheck,
}))

// Mock notifier.
const mockShowUpdateNotification = vi.hoisted(() => vi.fn())
const mockScheduleExitNotification = vi.hoisted(() => vi.fn())
vi.mock(import('../../../../src/util/update/notifier.mts'), () => ({
  showUpdateNotification: mockShowUpdateNotification,
  scheduleExitNotification: mockScheduleExitNotification,
}))

describe('update manager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDlxManifest.getManifestEntry.mockReturnValue(undefined)
    mockDlxManifest.setPackageEntry.mockResolvedValue(undefined)

    mockPerformUpdateCheck.mockResolvedValue({
      current: '1.0.0',
      latest: '2.0.0',
      updateAvailable: true,
    })
  })

  describe('invalid system time handling', () => {
    it('uses cached data when timestamp is invalid and cache is fresh', async () => {
      // Set up valid cache with a future timestamp for comparison.
      mockDlxManifest.getManifestEntry.mockReturnValue({
        type: 'package',
        cache_key: 'cached-package',
        timestamp: 1,
        details: {
          installed_version: '1.0.0',
          update_check: {
            last_check: Date.now() + 10_000,
            latest_known: '2.0.0',
          },
        },
      })

      // We can't actually mock Date.now() easily, but we can test the
      // scenario where cache exists but system time is wrong by
      // verifying the checkForUpdates function behavior.
      const result = await checkForUpdates('socket', '1.0.0')

      // Cache is fresh (timestampFetch > current time), so no fetch.
      expect(mockPerformUpdateCheck).not.toHaveBeenCalled()
      // Update available because 1.0.0 !== 2.0.0.
      expect(result).toBe(true)
    })

    it('handles cache with invalid timestamp data', async () => {
      // Cache with no timestampFetch.
      mockDlxManifest.getManifestEntry.mockReturnValue({
        type: 'package',
        cache_key: 'cached-package',
        timestamp: 1,
        details: {
          installed_version: '1.0.0',
          update_check: {
            latest_known: '2.0.0',
          },
        },
      })

      await checkForUpdates('socket', '1.0.0')

      // Should fetch because cache has no valid timestampFetch.
      expect(mockPerformUpdateCheck).toHaveBeenCalled()
    })

    it('handles cache with zero timestampFetch', async () => {
      mockDlxManifest.getManifestEntry.mockReturnValue({
        type: 'package',
        cache_key: 'cached-package',
        timestamp: 1,
        details: {
          installed_version: '1.0.0',
          update_check: {
            last_check: 0,
            latest_known: '2.0.0',
          },
        },
      })

      await checkForUpdates('socket', '1.0.0')

      // Should fetch because timestampFetch is 0.
      expect(mockPerformUpdateCheck).toHaveBeenCalled()
    })

    it('uses cached data when system time is broken (Date.now <= 0)', async () => {
      mockDlxManifest.getManifestEntry.mockReturnValueOnce({
        type: 'package',
        cache_key: 'cached-package',
        timestamp: 1,
        details: {
          installed_version: '1.0.0',
          update_check: {
            last_check: 1_000_000,
            latest_known: '2.0.0',
          },
        },
      })
      const realNow = Date.now
      Date.now = () => 0

      try {
        const result = await checkForUpdates('socket', '1.0.0', {
          immediate: true,
        })
        expect(result).toBe(true)
        expect(mockShowUpdateNotification).toHaveBeenCalled()
      } finally {
        Date.now = realNow
      }
    })

    it('schedules exit notification when system time is broken and not immediate', async () => {
      mockDlxManifest.getManifestEntry.mockReturnValueOnce({
        type: 'package',
        cache_key: 'cached-package',
        timestamp: 1,
        details: {
          installed_version: '1.0.0',
          update_check: {
            last_check: 1_000_000,
            latest_known: '2.0.0',
          },
        },
      })
      const realNow = Date.now
      Date.now = () => 0

      try {
        const result = await checkForUpdates('socket', '1.0.0', {
          immediate: false,
        })
        expect(result).toBe(true)
        expect(mockScheduleExitNotification).toHaveBeenCalled()
      } finally {
        Date.now = realNow
      }
    })

    it('returns false when system time is broken AND cache has no version', async () => {
      mockDlxManifest.getManifestEntry.mockReturnValueOnce({
        type: 'package',
        cache_key: 'cached-package',
        timestamp: 1,
        details: {
          installed_version: '1.0.0',
          update_check: {
            last_check: 1_000_000,
            latest_known: '',
          },
        },
      })
      const realNow = Date.now
      Date.now = () => 0

      try {
        const result = await checkForUpdates('socket', '1.0.0')
        expect(result).toBe(false)
      } finally {
        Date.now = realNow
      }
    })

    it('returns false when system time is broken AND no cache exists', async () => {
      mockDlxManifest.getManifestEntry.mockReturnValueOnce(undefined)
      const realNow = Date.now
      Date.now = () => 0

      try {
        const result = await checkForUpdates('socket', '1.0.0')
        expect(result).toBe(false)
      } finally {
        Date.now = realNow
      }
    })
  })

  describe('scheduleUpdateCheck', () => {
    it('performs update check for npm installations', async () => {
      await scheduleUpdateCheck('socket', '1.0.0')

      expect(mockPerformUpdateCheck).toHaveBeenCalled()
    })

    it('sets immediate to false', async () => {
      mockDlxManifest.getManifestEntry.mockReturnValue(undefined)

      await scheduleUpdateCheck('socket', '1.0.0', {
        immediate: true, // Should be overridden.
      })

      // Should schedule exit notification, not show immediately.
      expect(mockScheduleExitNotification).toHaveBeenCalled()
      expect(mockShowUpdateNotification).not.toHaveBeenCalled()
    })

    it('handles errors silently', async () => {
      mockPerformUpdateCheck.mockRejectedValue(new Error('Fatal error'))

      // Should not throw.
      await expect(
        scheduleUpdateCheck('socket', '1.0.0'),
      ).resolves.not.toThrow()

      // When fetch fails and no cache, logs about no version info.
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('No version information available'),
      )
    })
  })
})
