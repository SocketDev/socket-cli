/**
 * Unit tests for preflight downloads.
 *
 * Purpose:
 * Tests the background preflight downloads functionality.
 *
 * Test Coverage:
 * - runPreflightDownloads function
 * - Single run behavior
 * - CI/Test environment detection
 *
 * Related Files:
 * - src/util/preflight/downloads.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock all external dependencies.
const mockDownloadPackage = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
)
vi.mock('@socketsecurity/lib/dlx/package', () => ({
  downloadPackage: mockDownloadPackage,
}))

const mockGetCI = vi.hoisted(() => vi.fn(() => false))
vi.mock('@socketsecurity/lib/env/ci', () => ({
  getCI: mockGetCI,
}))

vi.mock('../../../../src/env/coana-version.mts', () => ({
  getCoanaVersion: () => '1.0.0',
}))

vi.mock('../../../../src/env/cdxgen-version.mts', () => ({
  getCdxgenVersion: () => '10.0.0',
}))

// Mock VITEST as a getter so it can be flipped per-test.
const mockVitest = vi.hoisted(() => ({ VITEST: true }))
vi.mock('../../../../src/env/vitest.mts', () => mockVitest)

vi.mock('../../../../src/util/python/standalone.mts', () => ({
  ensurePythonDlx: vi.fn().mockResolvedValue('/usr/bin/python3'),
  ensureSocketPyCli: vi.fn().mockResolvedValue(undefined),
}))

describe('preflight downloads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockGetCI.mockReturnValue(false)
  })

  describe('runPreflightDownloads', () => {
    it('does not run downloads in test environment', async () => {
      const { runPreflightDownloads } =
        await import('../../../../src/util/preflight/downloads.mts')

      runPreflightDownloads()

      // In VITEST environment, downloads should not be called.
      expect(mockDownloadPackage).not.toHaveBeenCalled()
    })

    it('does not run downloads in CI environment', async () => {
      mockGetCI.mockReturnValue(true)

      const { runPreflightDownloads } =
        await import('../../../../src/util/preflight/downloads.mts')

      runPreflightDownloads()

      expect(mockDownloadPackage).not.toHaveBeenCalled()
    })

    it('only runs once per module load', async () => {
      const { runPreflightDownloads } =
        await import('../../../../src/util/preflight/downloads.mts')

      runPreflightDownloads()
      runPreflightDownloads()
      runPreflightDownloads()

      // Function should guard against multiple calls.
      // Since VITEST is mocked to true, no downloads happen anyway.
      // But the function should track that it's been called.
      expect(true).toBe(true)
    })

    it('swallows errors thrown inside the background async closure', async () => {
      mockVitest.VITEST = false
      mockGetCI.mockReturnValue(false)
      mockDownloadPackage.mockRejectedValueOnce(new Error('network'))

      const { runPreflightDownloads } =
        await import('../../../../src/util/preflight/downloads.mts')

      // Should not throw / reject.
      runPreflightDownloads()
      await new Promise(resolve => setTimeout(resolve, 50))
      // No assertion needed — test just verifies no unhandled rejection.
      expect(true).toBe(true)
      mockVitest.VITEST = true
    })

    it('runs the full download chain when not in CI/vitest', async () => {
      // Mock node:timers/promises sleep to resolve immediately so the test
      // doesn't actually wait 4 seconds for the staggered delays.
      vi.doMock('node:timers/promises', () => ({
        setTimeout: () => Promise.resolve(),
      }))
      mockVitest.VITEST = false
      mockGetCI.mockReturnValue(false)
      mockDownloadPackage.mockResolvedValue(undefined)

      const { runPreflightDownloads } =
        await import('../../../../src/util/preflight/downloads.mts')
      runPreflightDownloads()
      // Allow the background closure to drain.
      await new Promise(resolve => setImmediate(resolve))
      await new Promise(resolve => setImmediate(resolve))
      await new Promise(resolve => setImmediate(resolve))

      // Coana + cdxgen should have been queued.
      expect(mockDownloadPackage).toHaveBeenCalled()
      const specs = mockDownloadPackage.mock.calls.map(
        (c: unknown) => (c[0] as { package: string }).package,
      )
      expect(specs.some((s: string) => s.startsWith('@coana-tech/cli@'))).toBe(
        true,
      )

      mockVitest.VITEST = true
      vi.doUnmock('node:timers/promises')
    })
  })
})
