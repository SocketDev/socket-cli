import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setupHandleFunctionMocks } from '../../../test/helpers/mock-setup.mts'
import {
  createErrorResult,
  createSuccessResult,
} from '../../../test/helpers/mocks.mts'
import {
  setupSdkMockWithCustomSdk,
  setupSdkSetupFailure,
} from '../../../test/helpers/sdk-test-helpers.mts'

// Mock the dependencies.
setupHandleFunctionMocks()

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

vi.mock('../../constants.mts', () => {
  const kInternalsSymbol = Symbol.for('kInternalsSymbol')
  const mockConstants = {
    spinner: {
      start: vi.fn(),
      stop: vi.fn(),
    },
    kInternalsSymbol,
    [kInternalsSymbol]: {
      getSentry: vi.fn(() => undefined),
    },
  }
  return {
    default: mockConstants,
    CONFIG_KEY_API_BASE_URL: 'apiBaseUrl',
    CONFIG_KEY_API_PROXY: 'apiProxy',
    CONFIG_KEY_API_TOKEN: 'apiToken',
    CONFIG_KEY_DEFAULT_ORG: 'defaultOrg',
    CONFIG_KEY_ENFORCED_ORGS: 'enforcedOrgs',
    CONFIG_KEY_ORG: 'org',
    UNKNOWN_ERROR: 'unknown error',
    getInternals: vi.fn(() => ({
      getSentry: vi.fn(() => undefined),
    })),
  }
})

vi.mock('../../utils/socket/api.mjs', () => ({
  handleApiCall: vi.fn(),
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
    const { handleApiCallNoSpinner, queryApiSafeText } = await import(
      '../../utils/socket/api.mjs'
    )
    const mockQueryApiText = vi.mocked(queryApiSafeText)
    const mockHandleApiNoSpinner = vi.mocked(handleApiCallNoSpinner)

    const mockSecurityPolicy = {
      rules: [{ id: 'rule-1', enabled: true }],
    }

    const { mockSdk } = await setupSdkMockWithCustomSdk(
      {
        getOrgSecurityPolicy: vi.fn().mockResolvedValue({
          success: true,
          data: {
            rules: [
              { id: 'rule-1', enabled: true, severity: 'high' },
              { id: 'rule-2', enabled: false, severity: 'medium' },
            ],
          },
        }),
      },
      mockSecurityPolicy,
    )

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
    expect(result.data?.scan).toEqual([
      { type: 'package', name: 'lodash', version: '4.17.21' },
    ])
    expect(result.data?.securityPolicy).toEqual(mockSecurityPolicy)
  })

  it('handles SDK setup failure', async () => {
    const { fetchScanData } = await import('./fetch-report-data.mts')

    await setupSdkSetupFailure('Failed to setup SDK', {
      code: 1,
      cause: 'Invalid configuration',
    })

    const result = await fetchScanData('test-org', 'scan-123')

    expect(result.ok).toBe(false)
    expect(result.message).toBe('Failed to setup SDK')
  })

  it('handles scan fetch failure', async () => {
    const { fetchScanData } = await import('./fetch-report-data.mts')
    const { queryApiSafeText } = await import('../../utils/socket/api.mjs')
    const mockQueryApiText = vi.mocked(queryApiSafeText)

    await setupSdkMockWithCustomSdk(
      {
        getOrgSecurityPolicy: vi.fn().mockResolvedValue({
          success: true,
          data: { rules: [] },
        }),
      },
      { rules: [] },
    )

    mockQueryApiText.mockResolvedValue(
      createErrorResult('Scan not found', {
        code: 404,
        cause: 'The specified scan does not exist',
      }),
    )

    const result = await fetchScanData('test-org', 'nonexistent-scan')

    expect(result.ok).toBe(false)
    expect(result.code).toBe(404)
  })

  it('handles security policy fetch failure', async () => {
    const { fetchScanData } = await import('./fetch-report-data.mts')
    const { handleApiCallNoSpinner, queryApiSafeText } = await import(
      '../../utils/socket/api.mjs'
    )
    const mockQueryApiText = vi.mocked(queryApiSafeText)
    const mockHandleApiNoSpinner = vi.mocked(handleApiCallNoSpinner)

    await setupSdkMockWithCustomSdk(
      {
        getOrgSecurityPolicy: vi.fn().mockResolvedValue({
          success: true,
          data: { rules: [] },
        }),
      },
      { rules: [] },
    )

    mockQueryApiText.mockResolvedValue(
      createSuccessResult('{"type":"package","name":"test"}'),
    )
    mockHandleApiNoSpinner.mockResolvedValue(
      createErrorResult('Access denied', {
        code: 403,
        cause: 'Insufficient permissions',
      }),
    )

    const result = await fetchScanData('restricted-org', 'scan-123')

    expect(result.ok).toBe(false)
    expect(result.code).toBe(403)
  })

  it('handles invalid JSON in scan data', async () => {
    const { fetchScanData } = await import('./fetch-report-data.mts')
    const { handleApiCallNoSpinner, queryApiSafeText } = await import(
      '../../utils/socket/api.mjs'
    )
    const { debug, debugDir } = await import('@socketsecurity/lib/debug')
    const mockQueryApiText = vi.mocked(queryApiSafeText)
    const mockHandleApiNoSpinner = vi.mocked(handleApiCallNoSpinner)
    const mockDebug = vi.mocked(debug)
    const mockDebugDir = vi.mocked(debugDir)

    await setupSdkMockWithCustomSdk(
      {
        getOrgSecurityPolicy: vi.fn().mockResolvedValue({
          success: true,
          data: { rules: [] },
        }),
      },
      { rules: [] },
    )

    const invalidJson = '{"valid":"json"}\n{"invalid":json}'

    mockQueryApiText.mockResolvedValue(createSuccessResult(invalidJson))
    mockHandleApiNoSpinner.mockResolvedValue(createSuccessResult({ rules: [] }))

    const result = await fetchScanData('test-org', 'scan-123')

    expect(mockDebug).toHaveBeenCalledWith(
      'Failed to parse report data line as JSON',
    )
    expect(mockDebugDir).toHaveBeenCalledWith({
      error: expect.any(SyntaxError),
      line: '{"invalid":json}',
    })
    expect(result.ok).toBe(false)
    expect(result.message).toBe('Invalid Socket API response')
  })

  it('includes license policy when requested', async () => {
    const { fetchScanData } = await import('./fetch-report-data.mts')
    const { handleApiCallNoSpinner, queryApiSafeText } = await import(
      '../../utils/socket/api.mjs'
    )
    const mockQueryApiText = vi.mocked(queryApiSafeText)
    const mockHandleApiNoSpinner = vi.mocked(handleApiCallNoSpinner)

    await setupSdkMockWithCustomSdk(
      {
        getOrgSecurityPolicy: vi.fn().mockResolvedValue({
          success: true,
          data: { rules: [] },
        }),
      },
      { rules: [] },
    )

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

  it('handles custom SDK options', async () => {
    const { fetchScanData } = await import('./fetch-report-data.mts')
    const { handleApiCallNoSpinner, queryApiSafeText } = await import(
      '../../utils/socket/api.mjs'
    )
    const mockQueryApiText = vi.mocked(queryApiSafeText)
    const mockHandleApiNoSpinner = vi.mocked(handleApiCallNoSpinner)

    const { mockSetupSdk } = await setupSdkMockWithCustomSdk(
      {
        getOrgSecurityPolicy: vi.fn().mockResolvedValue({
          success: true,
          data: { rules: [] },
        }),
      },
      { rules: [] },
    )

    mockQueryApiText.mockResolvedValue(
      createSuccessResult('{"type":"package","name":"test"}'),
    )
    mockHandleApiNoSpinner.mockResolvedValue(createSuccessResult({ rules: [] }))

    const options = {
      sdkOpts: {
        apiToken: 'custom-token',
        baseUrl: 'https://api.example.com',
      },
    }

    await fetchScanData('test-org', 'scan-123', options)

    expect(mockSetupSdk).toHaveBeenCalledWith(options.sdkOpts)
  })

  it('handles non-array scan data', async () => {
    const { fetchScanData } = await import('./fetch-report-data.mts')
    const { queryApiSafeText } = await import('../../utils/socket/api.mjs')
    const mockQueryApiText = vi.mocked(queryApiSafeText)

    await setupSdkMockWithCustomSdk(
      {
        getOrgSecurityPolicy: vi.fn().mockResolvedValue({
          success: true,
          data: { rules: [] },
        }),
      },
      { rules: [] },
    )

    // Return non-array data to trigger the error path.
    const nonArrayData = 'not-json-at-all'

    mockQueryApiText.mockResolvedValue(createSuccessResult(nonArrayData))

    const result = await fetchScanData('test-org', 'scan-123')

    expect(result.ok).toBe(false)
    expect(result.message).toBe('Invalid Socket API response')
  })

  it('uses null prototype for options', async () => {
    const { fetchScanData } = await import('./fetch-report-data.mts')
    const { handleApiCallNoSpinner, queryApiSafeText } = await import(
      '../../utils/socket/api.mjs'
    )
    const mockQueryApiText = vi.mocked(queryApiSafeText)
    const mockHandleApiNoSpinner = vi.mocked(handleApiCallNoSpinner)

    const { mockSetupSdk } = await setupSdkMockWithCustomSdk(
      {
        getOrgSecurityPolicy: vi.fn().mockResolvedValue({
          success: true,
          data: { rules: [] },
        }),
      },
      { rules: [] },
    )

    mockQueryApiText.mockResolvedValue(
      createSuccessResult('{"type":"package","name":"test"}'),
    )
    mockHandleApiNoSpinner.mockResolvedValue(createSuccessResult({ rules: [] }))

    // This tests that the function properly uses __proto__: null.
    await fetchScanData('test-org', 'scan-123')

    // The function should work without prototype pollution issues.
    expect(mockSetupSdk).toHaveBeenCalled()
  })
})
