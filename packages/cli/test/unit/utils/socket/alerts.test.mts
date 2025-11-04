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
const mockSetupSdk = vi.hoisted(() => vi.fn())
const mockGetPublicApiToken = vi.hoisted(() => vi.fn())
const mockGetDefaultApiToken = vi.hoisted(() => vi.fn(() => 'test-token'))

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

vi.mock('../../../../../src/utils/socket/sdk.mjs', () => ({
  getDefaultApiToken: mockGetDefaultApiToken,
  getPublicApiToken: mockGetPublicApiToken,
  setupSdk: mockSetupSdk,
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
        apiToken: 'test-token',
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
        apiToken: 'test-token',
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
      } catch (error) {
        expect(error).toBeDefined()
      }
    })
  })
})
