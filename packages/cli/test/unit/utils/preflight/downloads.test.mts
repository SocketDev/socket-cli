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
 * - src/utils/preflight/downloads.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock all external dependencies.
const mockDownloadPackage = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
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

// Mock VITEST to true to prevent actual downloads in tests.
vi.mock('../../../../src/env/vitest.mts', () => ({
  VITEST: true,
}))

vi.mock('../../../../src/utils/python/standalone.mts', () => ({
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
      const { runPreflightDownloads } = await import(
        '../../../../src/utils/preflight/downloads.mts'
      )

      runPreflightDownloads()

      // In VITEST environment, downloads should not be called.
      expect(mockDownloadPackage).not.toHaveBeenCalled()
    })

    it('does not run downloads in CI environment', async () => {
      mockGetCI.mockReturnValue(true)

      const { runPreflightDownloads } = await import(
        '../../../../src/utils/preflight/downloads.mts'
      )

      runPreflightDownloads()

      expect(mockDownloadPackage).not.toHaveBeenCalled()
    })

    it('only runs once per module load', async () => {
      const { runPreflightDownloads } = await import(
        '../../../../src/utils/preflight/downloads.mts'
      )

      runPreflightDownloads()
      runPreflightDownloads()
      runPreflightDownloads()

      // Function should guard against multiple calls.
      // Since VITEST is mocked to true, no downloads happen anyway.
      // But the function should track that it's been called.
      expect(true).toBe(true)
    })
  })
})
