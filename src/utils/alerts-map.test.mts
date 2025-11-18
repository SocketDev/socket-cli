import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getAlertsMapFromPurls } from './alerts-map.mts'

// Mock all dependencies with vi.hoisted for better type safety.
const mockSetupSdk = vi.hoisted(() => vi.fn())
const mockFindSocketYmlSync = vi.hoisted(() => vi.fn())
const mockAddArtifactToAlertsMap = vi.hoisted(() => vi.fn())
const mockBatchPackageStream = vi.hoisted(() => vi.fn())

vi.mock('./sdk.mts', () => ({
  setupSdk: mockSetupSdk,
}))

vi.mock('./config.mts', () => ({
  findSocketYmlSync: mockFindSocketYmlSync,
}))

vi.mock('./socket-package-alert.mts', () => ({
  addArtifactToAlertsMap: mockAddArtifactToAlertsMap,
}))

vi.mock('./filter-config.mts', () => ({
  toFilterConfig: vi.fn(filter => filter || {}),
}))

describe('Alerts Map', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Setup default mock implementations.
    mockFindSocketYmlSync.mockReturnValue({ ok: false, data: undefined })
    mockAddArtifactToAlertsMap.mockResolvedValue(undefined)

    mockBatchPackageStream.mockImplementation(async function* () {
      yield {
        success: true,
        data: {
          alerts: [],
          name: 'lodash',
          purl: 'pkg:npm/lodash@4.17.21',
          version: '4.17.21',
        },
      }
    })

    mockSetupSdk.mockResolvedValue({
      ok: true,
      data: {
        batchPackageStream: mockBatchPackageStream,
      },
    })
  })

  describe('getAlertsMapFromPurls', () => {
    it('should pass undefined apiToken to setupSdk when not provided', async () => {
      const purls = ['pkg:npm/lodash@4.17.21']

      await getAlertsMapFromPurls(purls, {
        nothrow: true,
      })

      // setupSdk should be called with undefined apiToken to let it handle token resolution.
      expect(mockSetupSdk).toHaveBeenCalledWith({ apiToken: undefined })
    })

    it('should pass provided apiToken to setupSdk when explicitly set', async () => {
      const purls = ['pkg:npm/lodash@4.17.21']
      const customToken = 'sktsec_test_custom_token'

      await getAlertsMapFromPurls(purls, {
        apiToken: customToken,
        nothrow: true,
      })

      // setupSdk should be called with the custom token.
      expect(mockSetupSdk).toHaveBeenCalledWith({ apiToken: customToken })
    })

    it('should return empty map when no purls provided', async () => {
      const alertsMap = await getAlertsMapFromPurls([], {
        nothrow: true,
      })

      expect(alertsMap).toBeInstanceOf(Map)
      expect(alertsMap.size).toBe(0)
      // setupSdk should not be called if there are no purls.
      expect(mockSetupSdk).not.toHaveBeenCalled()
    })

    it('should process purls and return alerts map', async () => {
      const purls = ['pkg:npm/lodash@4.17.21', 'pkg:npm/express@4.18.2']

      const alertsMap = await getAlertsMapFromPurls(purls, {
        nothrow: true,
      })

      expect(alertsMap).toBeInstanceOf(Map)
      expect(mockSetupSdk).toHaveBeenCalledWith({ apiToken: undefined })
      expect(mockBatchPackageStream).toHaveBeenCalled()
    })

    it('should handle filter options correctly', async () => {
      const purls = ['pkg:npm/lodash@4.17.21']

      await getAlertsMapFromPurls(purls, {
        filter: { actions: ['error', 'warn'] },
        nothrow: true,
      })

      expect(mockSetupSdk).toHaveBeenCalled()
      expect(mockBatchPackageStream).toHaveBeenCalled()
    })
  })
})
