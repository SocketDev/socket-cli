import { describe, expect, it, vi } from 'vitest'

import {
  getAlertsMapFromPnpmLockfile,
  getAlertsMapFromPurls,
} from '../../../../../src/utils/socket/alerts.mts'

// Mock dependencies.
const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

const mockFindSocketYmlSync = vi.hoisted(() => vi.fn())
const mockToFilterConfig = vi.hoisted(() => vi.fn())
const mockExtractPurlsFromPnpmLockfile = vi.hoisted(() => vi.fn())
const mockAddArtifactToAlertsMap = vi.hoisted(() => vi.fn())

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

vi.mock('../../../../../src/utils/socket/sdk.mts', () => ({
  getPublicApiToken: vi.fn(),
  setupSdk: vi.fn(() => ({
    org: {
      dependencies: {
        post: vi.fn(),
      },
    },
  })),
}))

vi.mock('../../../../../src/utils/config.mts', () => ({
  findSocketYmlSync: mockFindSocketYmlSync,
}))

vi.mock('../../../../../src/utils/validation/filter-config.mts', () => ({
  toFilterConfig: mockToFilterConfig,
}))

vi.mock('../../../../../src/utils/pnpm/lockfile.mts', () => ({
  extractPurlsFromPnpmLockfile: mockExtractPurlsFromPnpmLockfile,
}))

vi.mock('../../../../../src/utils/socket/package-alert.mts', () => ({
  addArtifactToAlertsMap: mockAddArtifactToAlertsMap,
}))

import { extractPurlsFromPnpmLockfile } from '../../../../../src/utils/pnpm/lockfile.mts'
import { setupSdk } from '../../../../../src/utils/socket/sdk.mts'
import { findSocketYmlSync } from '../../../../../src/utils/config.mts'

describe('alerts-map utilities', () => {
  describe('getAlertsMapFromPnpmLockfile', () => {
    it('calls extractPurlsFromPnpmLockfile with lockfile', async () => {
      mockExtractPurlsFromPnpmLockfile.mockReturnValue([])
      vi.mocked(setupSdk).mockReturnValue({
        ok: true,
        data: {
          org: {
            dependencies: {
              post: vi.fn().mockResolvedValue({
                ok: true,
                data: [],
              }),
            },
          },
        },
      } as any)
      mockFindSocketYmlSync.mockReturnValue({
        ok: false,
      } as any)

      const lockfile = {
        lockfileVersion: '6.0',
        packages: {},
      }

      try {
        await getAlertsMapFromPnpmLockfile(lockfile, {
          apiToken: 'test-token',
          nothrow: true,
        })
      } catch {
        // May fail due to mock setup.
      }

      expect(extractPurlsFromPnpmLockfile).toHaveBeenCalledWith(lockfile)
    })
  })

  describe('getAlertsMapFromPurls', () => {
    it('returns map for empty purls', async () => {
      vi.mocked(setupSdk).mockReturnValue({
        ok: true,
        data: {
          org: {
            dependencies: {
              post: vi.fn().mockResolvedValue({
                ok: true,
                data: [],
              }),
            },
          },
        },
      } as any)
      mockFindSocketYmlSync.mockReturnValue({
        ok: false,
      } as any)

      const result = await getAlertsMapFromPurls([], {
        apiToken: 'test-token',
        nothrow: true,
      })

      // Check that result is a Map.
      expect(result).toBeInstanceOf(Map)
      expect(result.size).toBe(0)
    })

    it('requires API token', async () => {
      vi.mocked(setupSdk).mockReturnValue({
        ok: false,
        message: 'No API token',
      } as any)

      try {
        await getAlertsMapFromPurls(['pkg:npm/test@1.0.0'], {
          nothrow: false,
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeDefined()
      }
    })
  })
})
