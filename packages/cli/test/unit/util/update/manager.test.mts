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
  get: vi.fn(),
  set: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/dlx/manifest'), () => ({
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

// Mock SEA detect.
const mockIsSeaBinary = vi.hoisted(() => vi.fn(() => false))
vi.mock(import('../../../../src/util/sea/detect.mts'), () => ({
  isSeaBinary: mockIsSeaBinary,
}))

import {
  checkForUpdates,
  scheduleUpdateCheck,
} from '../../../../src/util/update/manager.mts'

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

  describe('invalid system time handling', () => {
    it('uses cached data when timestamp is invalid and cache is fresh', async () => {
      // Set up valid cache with a future timestamp for comparison.
      mockDlxManifest.get.mockReturnValue({
        timestampFetch: Date.now() + 10_000,
        version: '2.0.0',
      })

      // We can't actually mock Date.now() easily, but we can test the
      // scenario where cache exists but system time is wrong by
      // verifying the checkForUpdates function behavior.
      const result = await checkForUpdates({
        name: 'socket',
        version: '1.0.0',
      })

      // Cache is fresh (timestampFetch > current time), so no fetch.
      expect(mockPerformUpdateCheck).not.toHaveBeenCalled()
      // Update available because 1.0.0 !== 2.0.0.
      expect(result).toBe(true)
    })

    it('handles cache with invalid timestamp data', async () => {
      // Cache with no timestampFetch.
      mockDlxManifest.get.mockReturnValue({
        version: '2.0.0',
      })

      await checkForUpdates({
        name: 'socket',
        version: '1.0.0',
      })

      // Should fetch because cache has no valid timestampFetch.
      expect(mockPerformUpdateCheck).toHaveBeenCalled()
    })

    it('handles cache with zero timestampFetch', async () => {
      mockDlxManifest.get.mockReturnValue({
        timestampFetch: 0,
        version: '2.0.0',
      })

      await checkForUpdates({
        name: 'socket',
        version: '1.0.0',
      })

      // Should fetch because timestampFetch is 0.
      expect(mockPerformUpdateCheck).toHaveBeenCalled()
    })

    it('uses cached data when system time is broken (Date.now <= 0)', async () => {
      mockDlxManifest.get.mockReturnValueOnce({
        timestampFetch: 1_000_000,
        version: '2.0.0',
      })
      const realNow = Date.now
      Date.now = () => 0

      try {
        const result = await checkForUpdates({
          name: 'socket',
          version: '1.0.0',
          immediate: true,
        })
        expect(result).toBe(true)
        expect(mockShowUpdateNotification).toHaveBeenCalled()
      } finally {
        Date.now = realNow
      }
    })

    it('schedules exit notification when system time is broken and not immediate', async () => {
      mockDlxManifest.get.mockReturnValueOnce({
        timestampFetch: 1_000_000,
        version: '2.0.0',
      })
      const realNow = Date.now
      Date.now = () => 0

      try {
        const result = await checkForUpdates({
          name: 'socket',
          version: '1.0.0',
          immediate: false,
        })
        expect(result).toBe(true)
        expect(mockScheduleExitNotification).toHaveBeenCalled()
      } finally {
        Date.now = realNow
      }
    })

    it('returns false when system time is broken AND cache has no version', async () => {
      mockDlxManifest.get.mockReturnValueOnce({
        timestampFetch: 1_000_000,
        version: '',
      })
      const realNow = Date.now
      Date.now = () => 0

      try {
        const result = await checkForUpdates({
          name: 'socket',
          version: '1.0.0',
        })
        expect(result).toBe(false)
      } finally {
        Date.now = realNow
      }
    })

    it('returns false when system time is broken AND no cache exists', async () => {
      mockDlxManifest.get.mockReturnValueOnce(undefined)
      const realNow = Date.now
      Date.now = () => 0

      try {
        const result = await checkForUpdates({
          name: 'socket',
          version: '1.0.0',
        })
        expect(result).toBe(false)
      } finally {
        Date.now = realNow
      }
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
