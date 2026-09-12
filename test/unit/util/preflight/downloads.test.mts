/**
 * Unit tests for preflight downloads.
 *
 * Purpose: Tests the background preflight downloads functionality.
 *
 * Test Coverage: - runPreflightDownloads function - Single run behavior -
 * CI/Test environment detection.
 *
 * Related Files: - src/util/preflight/downloads.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { settlePromiseCallbacks } from '../../../helpers/promise-callbacks.mts'

const { mockSleep, mockEnsurePython, mockEnsureSocketPyCli } = vi.hoisted(
  () => ({
    mockSleep: vi.fn(),
    mockEnsurePython: vi.fn(),
    mockEnsureSocketPyCli: vi.fn(),
  }),
)

vi.mock(import('node:timers/promises'), () => ({ setTimeout: mockSleep }))

// Mock all external dependencies.
const mockDownloadPackage = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
)
vi.mock(import('@socketsecurity/lib-stable/dlx/package'), () => ({
  downloadNpmPackage: mockDownloadPackage,
}))

const mockGetCI = vi.hoisted(() => vi.fn(() => false))
vi.mock(import('@socketsecurity/lib-stable/env/ci'), () => ({
  isCI: mockGetCI,
}))

vi.mock(import('../../../../src/env/coana-version.mts'), () => ({
  getCoanaVersion: () => '1.0.0',
}))

// Mock VITEST as a getter so it can be flipped per-test.
const mockVitest = vi.hoisted(() => ({ VITEST: true }))
vi.mock(import('../../../../src/env/vitest.mts'), () => mockVitest)

vi.mock(import('../../../../src/util/python/standalone.mts'), () => ({
  ensurePythonDlx: mockEnsurePython,
  ensureSocketPyCli: mockEnsureSocketPyCli,
}))

describe('preflight downloads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockGetCI.mockReturnValue(false)
    mockVitest.VITEST = true
    mockDownloadPackage.mockReset().mockResolvedValue(undefined)
    mockSleep.mockReset().mockResolvedValue(undefined)
    mockEnsurePython.mockReset().mockResolvedValue('/usr/bin/python3')
    mockEnsureSocketPyCli.mockReset().mockResolvedValue(undefined)
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
      mockVitest.VITEST = false
      const { runPreflightDownloads } =
        await import('../../../../src/util/preflight/downloads.mts')

      runPreflightDownloads()
      runPreflightDownloads()
      runPreflightDownloads()

      await settlePromiseCallbacks()
      expect(mockDownloadPackage).toHaveBeenCalledOnce()
      expect(mockEnsurePython).toHaveBeenCalledOnce()
      expect(mockEnsureSocketPyCli).toHaveBeenCalledOnce()
    })

    it('swallows errors thrown inside the background async closure', async () => {
      mockVitest.VITEST = false
      mockGetCI.mockReturnValue(false)
      mockDownloadPackage.mockRejectedValueOnce(new Error('network'))

      const { runPreflightDownloads } =
        await import('../../../../src/util/preflight/downloads.mts')

      expect(() => runPreflightDownloads()).not.toThrow()
      await settlePromiseCallbacks()
      expect(mockDownloadPackage).toHaveBeenCalledOnce()
      expect(mockDownloadPackage).toHaveBeenCalledWith({
        binaryName: 'coana',
        force: false,
        spec: '@coana-tech/cli@1.0.0',
      })
      expect(mockSleep).not.toHaveBeenCalled()
      expect(mockEnsurePython).not.toHaveBeenCalled()
      expect(mockEnsureSocketPyCli).not.toHaveBeenCalled()
    })

    it('runs the full download chain when not in CI/vitest', async () => {
      mockVitest.VITEST = false
      mockGetCI.mockReturnValue(false)
      mockDownloadPackage.mockResolvedValue(undefined)

      const { runPreflightDownloads } =
        await import('../../../../src/util/preflight/downloads.mts')
      runPreflightDownloads()
      await settlePromiseCallbacks()
      expect(mockDownloadPackage.mock.calls).toEqual([
        [{ binaryName: 'coana', force: false, spec: '@coana-tech/cli@1.0.0' }],
      ])
      expect(mockSleep.mock.calls).toEqual([[2000]])
      expect(mockEnsurePython).toHaveBeenCalledOnce()
      expect(mockEnsureSocketPyCli).toHaveBeenCalledWith('/usr/bin/python3')
    })
  })
})
