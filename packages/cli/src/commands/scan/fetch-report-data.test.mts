import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../test/helpers/mocks.mts'

vi.mock('@socketsecurity/lib/debug', () => ({
  debug: vi.fn(),
  debugDir: vi.fn(),
  debugFn: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', () => ({
  logger: {
    info: vi.fn(),
  },
}))

vi.mock('@socketsecurity/lib/constants/process', () => ({
  getSpinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
}))

vi.mock('../../utils/socket/api.mts', () => ({
  handleApiCallNoSpinner: vi.fn(),
  queryApiSafeText: vi.fn(),
}))

vi.mock('../../utils/socket/sdk.mjs', () => ({
  setupSdk: vi.fn(),
}))

vi.mock('../../utils/error/errors.mjs', () => ({
  formatErrorWithDetail: vi.fn(),
}))

describe('fetchScanData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches scan data successfully', async () => {
    const { fetchScanData } = await import('./fetch-report-data.mts')
    const { setupSdk } = await vi.importMock('../../utils/socket/sdk.mjs')
    const { handleApiCallNoSpinner, queryApiSafeText } = await vi.importMock(
      '../../utils/socket/api.mts',
    )

    const mockSetupSdk = vi.mocked(setupSdk)
    const mockQueryApiText = vi.mocked(queryApiSafeText)
    const mockHandleApiNoSpinner = vi.mocked(handleApiCallNoSpinner)

    const mockSdk = {
      getOrgSecurityPolicy: vi.fn().mockResolvedValue({
        success: true,
        data: {
          rules: [{ id: 'rule-1', enabled: true }],
        },
      }),
    }

    const mockSecurityPolicy = {
      rules: [{ id: 'rule-1', enabled: true }],
    }

    mockSetupSdk.mockResolvedValue(createSuccessResult(mockSdk as any))

    const mockScanData = JSON.stringify({
      type: 'package',
      name: 'lodash',
      version: '4.17.21',
    })

    mockQueryApiText.mockResolvedValue(createSuccessResult(mockScanData))
    mockHandleApiNoSpinner.mockResolvedValue(
      createSuccessResult(mockSecurityPolicy),
    )

    const result = await fetchScanData('test-org', 'scan-123')

    expect(mockQueryApiText).toHaveBeenCalledWith(
      'orgs/test-org/full-scans/scan-123',
    )
    expect(mockSdk.getOrgSecurityPolicy).toHaveBeenCalledWith('test-org')
    expect(mockHandleApiNoSpinner).toHaveBeenCalledWith(
      expect.any(Promise),
      'GetOrgSecurityPolicy',
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.scan).toEqual([
        { type: 'package', name: 'lodash', version: '4.17.21' },
      ])
      expect(result.data.securityPolicy).toEqual(mockSecurityPolicy)
    }
  })

  it('handles SDK setup failure', async () => {
    const { fetchScanData } = await import('./fetch-report-data.mts')
    const { setupSdk } = await vi.importMock('../../utils/socket/sdk.mjs')
    const mockSetupSdk = vi.mocked(setupSdk)

    const error = createErrorResult('Failed to setup SDK', {
      code: 1,
      cause: 'Invalid configuration',
    })
    mockSetupSdk.mockResolvedValue(error)

    const result = await fetchScanData('test-org', 'scan-123')

    expect(result).toEqual(error)
  })

  it('handles scan fetch failure', async () => {
    const { fetchScanData } = await import('./fetch-report-data.mts')
    const { setupSdk } = await vi.importMock('../../utils/socket/sdk.mjs')
    const { queryApiSafeText } = await vi.importMock('../../utils/socket/api.mts')

    const mockSetupSdk = vi.mocked(setupSdk)
    const mockQueryApiText = vi.mocked(queryApiSafeText)

    const mockSdk = {
      getOrgSecurityPolicy: vi.fn().mockResolvedValue({
        success: true,
        data: { rules: [] },
      }),
    }

    mockSetupSdk.mockResolvedValue(createSuccessResult(mockSdk as any))

    mockQueryApiText.mockResolvedValue(
      createErrorResult('Scan not found', {
        code: 404,
        cause: 'The specified scan does not exist',
      }),
    )

    const result = await fetchScanData('test-org', 'nonexistent-scan')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(404)
    }
  })

  it('includes license policy when requested', async () => {
    const { fetchScanData } = await import('./fetch-report-data.mts')
    const { setupSdk } = await vi.importMock('../../utils/socket/sdk.mjs')
    const { handleApiCallNoSpinner, queryApiSafeText } = await vi.importMock(
      '../../utils/socket/api.mts',
    )

    const mockSetupSdk = vi.mocked(setupSdk)
    const mockQueryApiText = vi.mocked(queryApiSafeText)
    const mockHandleApiNoSpinner = vi.mocked(handleApiCallNoSpinner)

    const mockSdk = {
      getOrgSecurityPolicy: vi.fn().mockResolvedValue({
        success: true,
        data: { rules: [] },
      }),
    }

    mockSetupSdk.mockResolvedValue(createSuccessResult(mockSdk as any))

    mockQueryApiText.mockResolvedValue(
      createSuccessResult('{"type":"package","name":"test"}'),
    )
    mockHandleApiNoSpinner.mockResolvedValue(createSuccessResult({ rules: [] }))

    const options = {
      includeLicensePolicy: true,
    }

    await fetchScanData('test-org', 'scan-123', options)

    expect(mockQueryApiText).toHaveBeenCalledWith(
      'orgs/test-org/full-scans/scan-123?include_license_details=true',
    )
  })
})
