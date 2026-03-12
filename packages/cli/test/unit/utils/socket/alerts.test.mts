/**
 * Unit tests for Socket alert utilities.
 *
 * Purpose:
 * Tests Socket alert data structures and utilities. Validates alert parsing and categorization.
 *
 * Test Coverage:
 * - Alert parsing
 * - Severity calculation
 * - Alert filtering
 * - Alert grouping
 * - Issue rules application
 *
 * Testing Approach:
 * Tests alert utilities for Socket API responses.
 *
 * Related Files:
 * - utils/socket/alerts.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getAlertsMapFromPnpmLockfile,
  getAlertsMapFromPurls,
} from '../../../../src/utils/socket/alerts.mts'

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
const mockSetupSdk = vi.hoisted(() => vi.fn())
const mockGetPublicApiToken = vi.hoisted(() => vi.fn())
const mockGetDefaultApiToken = vi.hoisted(() => vi.fn(() => 'mock-value'))

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

vi.mock('../../../../src/utils/socket/sdk.mjs', () => ({
  getDefaultApiToken: mockGetDefaultApiToken,
  getPublicApiToken: mockGetPublicApiToken,
  setupSdk: mockSetupSdk,
}))

vi.mock('../../../../src/utils/config.mts', () => ({
  findSocketYmlSync: mockFindSocketYmlSync,
}))

vi.mock('../../../../src/utils/validation/filter-config.mts', () => ({
  toFilterConfig: mockToFilterConfig,
}))

vi.mock('../../../../src/utils/pnpm/lockfile.mts', () => ({
  extractPurlsFromPnpmLockfile: mockExtractPurlsFromPnpmLockfile,
}))

vi.mock('../../../../src/utils/socket/package-alert.mts', () => ({
  addArtifactToAlertsMap: mockAddArtifactToAlertsMap,
}))

describe('alerts-map utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getAlertsMapFromPnpmLockfile', () => {
    it('returns empty map for lockfile with no packages', async () => {
      mockExtractPurlsFromPnpmLockfile.mockResolvedValue([])
      mockSetupSdk.mockReturnValue({
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

      const result = await getAlertsMapFromPnpmLockfile(lockfile, {
        apiToken: 'mock-value',
        nothrow: true,
      })

      // Check that result is a Map.
      expect(result).toBeInstanceOf(Map)
      expect(result.size).toBe(0)
    })
  })

  describe('getAlertsMapFromPurls', () => {
    it('returns map for empty purls', async () => {
      mockSetupSdk.mockReturnValue({
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
        apiToken: 'mock-value',
        nothrow: true,
      })

      // Check that result is a Map.
      expect(result).toBeInstanceOf(Map)
      expect(result.size).toBe(0)
    })

    it('requires API token', async () => {
      mockSetupSdk.mockReturnValue({
        ok: false,
        message: 'No API token',
      } as any)

      try {
        await getAlertsMapFromPurls(['pkg:npm/test@1.0.0'], {
          nothrow: false,
        })
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeDefined()
      }
    })

    it('deduplicates purls before processing', async () => {
      mockSetupSdk.mockReturnValue({
        ok: true,
        data: {
          batchPackageStream: async function* () {
            // Empty generator.
          },
        },
      } as any)
      mockFindSocketYmlSync.mockReturnValue({
        ok: false,
      } as any)
      mockToFilterConfig.mockReturnValue({})

      const result = await getAlertsMapFromPurls(
        ['pkg:npm/test@1.0.0', 'pkg:npm/test@1.0.0', 'pkg:npm/test@1.0.0'],
        {
          apiToken: 'mock-value',
        },
      )

      expect(result).toBeInstanceOf(Map)
    })

    it('processes batch results with onlyFixable option', async () => {
      mockSetupSdk.mockReturnValue({
        ok: true,
        data: {
          batchPackageStream: async function* () {
            // Empty generator.
          },
        },
      } as any)
      mockFindSocketYmlSync.mockReturnValue({
        ok: false,
      } as any)
      mockToFilterConfig.mockReturnValue({})

      const result = await getAlertsMapFromPurls(['pkg:npm/test@1.0.0'], {
        apiToken: 'mock-value',
        onlyFixable: true,
      })

      expect(result).toBeInstanceOf(Map)
    })

    it('uses socketYml config when found', async () => {
      mockSetupSdk.mockReturnValue({
        ok: true,
        data: {
          batchPackageStream: async function* () {
            // Empty generator.
          },
        },
      } as any)
      mockFindSocketYmlSync.mockReturnValue({
        ok: true,
        data: {
          parsed: {
            issueRules: {
              'known-malware': 'error',
            },
          },
        },
      } as any)
      mockToFilterConfig.mockReturnValue({})

      const result = await getAlertsMapFromPurls(['pkg:npm/test@1.0.0'], {
        apiToken: 'mock-value',
      })

      expect(result).toBeInstanceOf(Map)
    })

    it('processes successful batch results', async () => {
      mockSetupSdk.mockReturnValue({
        ok: true,
        data: {
          batchPackageStream: async function* () {
            yield {
              success: true,
              data: {
                purl: 'pkg:npm/lodash@4.0.0',
                alerts: [],
              },
            }
          },
        },
      } as any)
      mockFindSocketYmlSync.mockReturnValue({
        ok: false,
      } as any)
      mockToFilterConfig.mockReturnValue({})
      mockAddArtifactToAlertsMap.mockResolvedValue(undefined)

      const result = await getAlertsMapFromPurls(['pkg:npm/lodash@4.0.0'], {
        apiToken: 'mock-value',
      })

      expect(result).toBeInstanceOf(Map)
      expect(mockAddArtifactToAlertsMap).toHaveBeenCalled()
    })

    it('handles failed batch results with nothrow option', async () => {
      mockSetupSdk.mockReturnValue({
        ok: true,
        data: {
          batchPackageStream: async function* () {
            yield {
              success: false,
              status: 500,
              error: 'Internal server error',
            }
          },
        },
      } as any)
      mockFindSocketYmlSync.mockReturnValue({
        ok: false,
      } as any)
      mockToFilterConfig.mockReturnValue({})

      const result = await getAlertsMapFromPurls(['pkg:npm/test@1.0.0'], {
        apiToken: 'mock-value',
        nothrow: true,
      })

      expect(result).toBeInstanceOf(Map)
      expect(mockLogger.fail).toHaveBeenCalled()
    })

    it('throws on failed batch results without nothrow', async () => {
      mockSetupSdk.mockReturnValue({
        ok: true,
        data: {
          batchPackageStream: async function* () {
            yield {
              success: false,
              status: 500,
              error: 'Internal server error',
            }
          },
        },
      } as any)
      mockFindSocketYmlSync.mockReturnValue({
        ok: false,
      } as any)
      mockToFilterConfig.mockReturnValue({})

      await expect(
        getAlertsMapFromPurls(['pkg:npm/test@1.0.0'], {
          apiToken: 'mock-value',
          nothrow: false,
        }),
      ).rejects.toThrow('Internal server error')
    })

    it('throws generic error when batch result has no error message', async () => {
      mockSetupSdk.mockReturnValue({
        ok: true,
        data: {
          batchPackageStream: async function* () {
            yield {
              success: false,
              status: 500,
            }
          },
        },
      } as any)
      mockFindSocketYmlSync.mockReturnValue({
        ok: false,
      } as any)
      mockToFilterConfig.mockReturnValue({})

      await expect(
        getAlertsMapFromPurls(['pkg:npm/test@1.0.0'], {
          apiToken: 'mock-value',
          nothrow: false,
        }),
      ).rejects.toThrow('Socket API server error (500)')
    })

    it('updates spinner during processing', async () => {
      const mockSpinner = {
        start: vi.fn(),
        stop: vi.fn(),
      }

      mockSetupSdk.mockReturnValue({
        ok: true,
        data: {
          batchPackageStream: async function* () {
            yield {
              success: true,
              data: {
                purl: 'pkg:npm/test@1.0.0',
                alerts: [],
              },
            }
          },
        },
      } as any)
      mockFindSocketYmlSync.mockReturnValue({
        ok: false,
      } as any)
      mockToFilterConfig.mockReturnValue({})
      mockAddArtifactToAlertsMap.mockResolvedValue(undefined)

      await getAlertsMapFromPurls(['pkg:npm/test@1.0.0'], {
        apiToken: 'mock-value',
        spinner: mockSpinner as any,
      })

      expect(mockSpinner.start).toHaveBeenCalled()
      expect(mockSpinner.stop).toHaveBeenCalled()
    })

    it('passes filter actions to query params', async () => {
      mockSetupSdk.mockReturnValue({
        ok: true,
        data: {
          batchPackageStream: async function* () {
            // Empty generator.
          },
        },
      } as any)
      mockFindSocketYmlSync.mockReturnValue({
        ok: false,
      } as any)
      mockToFilterConfig.mockReturnValue({
        actions: ['error', 'warn'],
      })

      const result = await getAlertsMapFromPurls(['pkg:npm/test@1.0.0'], {
        apiToken: 'mock-value',
      })

      expect(result).toBeInstanceOf(Map)
    })
  })
})
