/**
 * Unit tests for update manager utilities.
 *
 * Purpose: Tests the checkForUpdates function of the update manager for
 * npm/pnpm/yarn installations.
 *
 * Test Coverage: - checkForUpdates function - Parameter validation - Cache
 * handling - Notifications - Error handling - Registry URL handling.
 *
 * Related Files: - src/util/update/manager.mts (implementation) -
 * manager.test.mts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { checkForUpdates } from '../../../../src/util/update/manager.mts'

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

// Mock SEA detect.
const mockIsSeaBinary = vi.hoisted(() => vi.fn(() => false))
vi.mock(import('../../../../src/util/sea/detect.mts'), () => ({
  isSeaBinary: mockIsSeaBinary,
}))

describe('update manager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDlxManifest.getManifestEntry.mockReturnValue(undefined)
    mockDlxManifest.setPackageEntry.mockResolvedValue(undefined)
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
        const result = await checkForUpdates('', '1.0.0')

        expect(result).toBe(false)
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining(
            'checkForUpdates(name) requires a non-empty string',
          ),
        )
      })

      it('returns false for empty version', async () => {
        const result = await checkForUpdates('socket', '')

        expect(result).toBe(false)
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining(
            'checkForUpdates(name, version) requires version to be a non-empty string',
          ),
        )
      })

      it('returns false for negative TTL', async () => {
        const result = await checkForUpdates('socket', '1.0.0', {
          ttl: -1,
        })

        expect(result).toBe(false)
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining(
            'checkForUpdates options.ttl must be >= 0 (saw: -1)',
          ),
        )
      })

      it('warns about invalid auth info but continues', async () => {
        await checkForUpdates('socket', '1.0.0', {
          authInfo: { token: '', type: '' },
        })

        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Invalid auth info'),
        )
      })

      it('handles empty registry URL without warning', async () => {
        // Empty string is treated as "use default", not invalid.
        await checkForUpdates('socket', '1.0.0', {
          registryUrl: '',
        })

        // Should proceed without warning about registry URL.
        expect(mockPerformUpdateCheck).toHaveBeenCalled()
      })
    })

    describe('cache handling', () => {
      it('uses fresh cache and skips fetch', async () => {
        // Set up fresh cache.
        mockDlxManifest.getManifestEntry.mockReturnValue({
          type: 'package',
          cache_key: 'cached-package',
          timestamp: 1,
          details: {
            installed_version: '1.0.0',
            update_check: {
              last_check: Date.now() - 1000, // 1 second ago (fresh).
              latest_known: '1.0.0',
            },
          },
        })

        const result = await checkForUpdates('socket', '1.0.0', {
          ttl: 60_000, // 1 minute.
        })

        expect(result).toBe(false) // Same version.
        expect(mockPerformUpdateCheck).not.toHaveBeenCalled()
      })

      it('fetches when cache is stale', async () => {
        // Set up stale cache.
        mockDlxManifest.getManifestEntry.mockReturnValue({
          type: 'package',
          cache_key: 'cached-package',
          timestamp: 1,
          details: {
            installed_version: '1.0.0',
            update_check: {
              last_check: Date.now() - 120_000, // 2 minutes ago (stale).
              latest_known: '1.0.0',
            },
          },
        })

        await checkForUpdates('socket', '1.0.0', {
          ttl: 60_000, // 1 minute.
        })

        expect(mockPerformUpdateCheck).toHaveBeenCalled()
      })

      it('fetches when no cache exists', async () => {
        mockDlxManifest.getManifestEntry.mockReturnValue(undefined)

        await checkForUpdates('socket', '1.0.0')

        expect(mockPerformUpdateCheck).toHaveBeenCalled()
      })

      it('preserves package metadata when updating check timestamps', async () => {
        mockDlxManifest.getManifestEntry.mockReturnValue({
          type: 'package',
          cache_key: 'installed-package-cache',
          timestamp: 1,
          details: {
            installed_version: '1.0.0',
            size: 4096,
            update_check: {
              last_check: 1,
              last_notification: Date.now(),
              latest_known: '1.0.0',
            },
          },
        })

        await checkForUpdates('socket', '1.0.0')

        expect(mockDlxManifest.setPackageEntry).toHaveBeenCalledWith(
          'socket@1.0.0',
          'installed-package-cache',
          expect.objectContaining({
            installed_version: '1.0.0',
            size: 4096,
            update_check: expect.objectContaining({
              latest_known: '2.0.0',
              last_check: expect.any(Number),
            }),
          }),
        )
      })

      it('updates cache after successful fetch', async () => {
        mockDlxManifest.getManifestEntry.mockReturnValue(undefined)

        await checkForUpdates('socket', '1.0.0')

        expect(mockDlxManifest.setPackageEntry).toHaveBeenCalledWith(
          'socket@1.0.0',
          'socket@1.0.0',
          expect.objectContaining({
            installed_version: '1.0.0',
            update_check: expect.objectContaining({ latest_known: '2.0.0' }),
          }),
        )
      })
    })

    describe('notifications', () => {
      it('shows immediate notification when update available', async () => {
        mockDlxManifest.getManifestEntry.mockReturnValue(undefined)

        await checkForUpdates('socket', '1.0.0', {
          immediate: true,
        })

        expect(mockShowUpdateNotification).toHaveBeenCalledWith(
          'socket',
          '1.0.0',
          '2.0.0',
        )
      })

      it('schedules exit notification when not immediate', async () => {
        mockDlxManifest.getManifestEntry.mockReturnValue(undefined)

        await checkForUpdates('socket', '1.0.0', {
          immediate: false,
        })

        expect(mockScheduleExitNotification).toHaveBeenCalledWith(
          'socket',
          '1.0.0',
          '2.0.0',
        )
      })

      it('does not notify when no update available', async () => {
        mockPerformUpdateCheck.mockResolvedValue({
          current: '1.0.0',
          latest: '1.0.0',
          updateAvailable: false,
        })

        await checkForUpdates('socket', '1.0.0')

        expect(mockShowUpdateNotification).not.toHaveBeenCalled()
        expect(mockScheduleExitNotification).not.toHaveBeenCalled()
      })
    })

    describe('error handling', () => {
      it('uses cached version when fetch fails', async () => {
        mockDlxManifest.getManifestEntry.mockReturnValue({
          type: 'package',
          cache_key: 'cached-package',
          timestamp: 1,
          details: {
            installed_version: '1.0.0',
            update_check: {
              last_check: Date.now() - 120_000, // Stale.
              latest_known: '1.5.0',
            },
          },
        })
        mockPerformUpdateCheck.mockRejectedValue(new Error('Network error'))

        const result = await checkForUpdates('socket', '1.0.0', {
          ttl: 60_000,
        })

        expect(result).toBe(true) // 1.0.0 !== 1.5.0.
      })

      it('returns false when fetch fails and no cache', async () => {
        mockDlxManifest.getManifestEntry.mockReturnValue(undefined)
        mockPerformUpdateCheck.mockRejectedValue(new Error('Network error'))

        const result = await checkForUpdates('socket', '1.0.0')

        expect(result).toBe(false)
        expect(mockLogger.log).toHaveBeenCalledWith(
          'No version information available',
        )
      })

      it('handles cache access errors', async () => {
        mockDlxManifest.getManifestEntry.mockImplementation(() => {
          throw new Error('Cache read error')
        })

        // Should not throw.
        const result = await checkForUpdates('socket', '1.0.0')

        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Failed to access cache'),
        )
        // Should still try to fetch.
        expect(mockPerformUpdateCheck).toHaveBeenCalled()
        expect(result).toBe(true)
      })

      it('handles cache update errors gracefully', async () => {
        mockDlxManifest.getManifestEntry.mockReturnValue(undefined)
        mockDlxManifest.setPackageEntry.mockRejectedValue(
          new Error('Cache write error'),
        )

        // Should not throw.
        const result = await checkForUpdates('socket', '1.0.0')

        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Failed to update cache'),
        )
        expect(result).toBe(true)
      })

      it('handles notification setup errors gracefully', async () => {
        mockDlxManifest.getManifestEntry.mockReturnValue(undefined)
        mockShowUpdateNotification.mockImplementation(() => {
          throw new Error('Notification error')
        })

        // Should not throw.
        const result = await checkForUpdates('socket', '1.0.0', {
          immediate: true,
        })

        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Failed to set up notification'),
        )
        expect(result).toBe(true)
      })
    })

    describe('registry URL handling', () => {
      it('normalizes registry URL in cache key', async () => {
        mockDlxManifest.getManifestEntry.mockReturnValue(undefined)

        await checkForUpdates('socket', '1.0.0', {
          registryUrl: 'https://registry.npmjs.org',
        })

        expect(mockDlxManifest.setPackageEntry).toHaveBeenCalledWith(
          expect.stringContaining(':https://registry.npmjs.org/'),
          expect.any(String),
          expect.any(Object),
        )
      })

      it('handles invalid registry URL gracefully', async () => {
        mockDlxManifest.getManifestEntry.mockReturnValue(undefined)

        await checkForUpdates('socket', '1.0.0', {
          registryUrl: 'not-a-valid-url',
        })

        // Should use the raw string when URL parsing fails.
        expect(mockDlxManifest.setPackageEntry).toHaveBeenCalledWith(
          'socket@1.0.0:not-a-valid-url',
          expect.any(String),
          expect.any(Object),
        )
      })
    })
  })
})
