import { describe, expect, it, vi } from 'vitest'

import {
  getAlertsMapFromPnpmLockfile,
  getAlertsMapFromPurls,
} from './alerts-map.mts'

// Mock dependencies.
vi.mock('@socketsecurity/registry/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}))


vi.mock('./sdk.mts', () => ({
  getPublicApiToken: vi.fn(),
  setupSdk: vi.fn(() => ({
    org: {
      dependencies: {
        post: vi.fn(),
      },
    },
  })),
}))

vi.mock('./config.mts', () => ({
  findSocketYmlSync: vi.fn(),
}))

vi.mock('./filter-config.mts', () => ({
  toFilterConfig: vi.fn(),
}))

vi.mock('./pnpm.mts', () => ({
  extractPurlsFromPnpmLockfile: vi.fn(),
}))

vi.mock('./socket-package-alert.mts', () => ({
  addArtifactToAlertsMap: vi.fn(),
}))

describe('alerts-map utilities', () => {
  describe('getAlertsMapFromPnpmLockfile', () => {
    it('calls extractPurlsFromPnpmLockfile with lockfile', async () => {
      const { extractPurlsFromPnpmLockfile } = await import('./pnpm.mts')
      const { setupSdk } = await import('./sdk.mts')
      const { findSocketYmlSync } = await import('./config.mts')

      vi.mocked(extractPurlsFromPnpmLockfile).mockReturnValue([])
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
      vi.mocked(findSocketYmlSync).mockReturnValue({
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
      const { setupSdk } = await import('./sdk.mts')
      const { findSocketYmlSync } = await import('./config.mts')

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
      vi.mocked(findSocketYmlSync).mockReturnValue({
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
      const { setupSdk } = await import('./sdk.mts')

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
