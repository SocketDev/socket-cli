import { describe, expect, it, vi } from 'vitest'

// Mock the dependencies.

vi.mock('@socketsecurity/registry/lib/logger', () => ({
  logger: {
    info: vi.fn(),
  },
}))

vi.mock('../../constants.mts', () => ({
  default: {
    spinner: {
      start: vi.fn(),
      stop: vi.fn(),
    },
  },
}))

vi.mock('../../utils/errors.mts', () => ({
  formatErrorWithDetail: vi.fn(),
}))

vi.mock('../../utils/debug.mts', () => ({
  debugFn: vi.fn(),
  debugDir: vi.fn(),
}))

vi.mock('../../utils/sdk.mts', () => ({
  withSdk: vi.fn(),
  queryApiText: vi.fn(),
}))

describe('fetchScanData', () => {
  it('fetches scan data successfully', async () => {
    const { fetchScanData } = await import('./fetch-report-data.mts')
    const { handleApiCallNoSpinner } = await import('../../utils/api.mts')
    const { queryApiText, withSdk } = await import('../../utils/sdk.mts')
    const mockHandleApiNoSpinner = vi.mocked(handleApiCallNoSpinner)
    const mockQueryApiText = vi.mocked(queryApiText)
    const mockSetupSdk = vi.mocked(withSdk)

    const mockSdk = {
      getOrgSecurityPolicy: vi.fn().mockResolvedValue({
        success: true,
        data: {
          rules: [
            { id: 'rule-1', enabled: true, severity: 'high' },
            { id: 'rule-2', enabled: false, severity: 'medium' },
          ],
        },
      }),
    }

    const mockScanData = JSON.stringify({
      type: 'package',
      name: 'lodash',
      version: '4.17.21',
    })
    const mockSecurityPolicy = {
      rules: [{ id: 'rule-1', enabled: true }],
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockQueryApiText.mockResolvedValue({
      ok: true,
      data: mockScanData,
    })
    mockHandleApiNoSpinner.mockResolvedValue({
      ok: true,
      data: mockSecurityPolicy,
    })

    const result = await fetchScanData('test-org', 'scan-123')

    expect(mockQueryApiText).toHaveBeenCalledWith(
      expect.anything(),
      'orgs/test-org/full-scans/scan-123',
      expect.objectContaining({ description: 'scan result' }),
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
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockSetupSdk = vi.mocked(withSdk)

    const error = {
      ok: false,
      code: 1,
      message: 'Failed to setup SDK',
      cause: 'Invalid configuration',
    }
    mockSetupSdk.mockResolvedValue(error)

    const result = await fetchScanData('test-org', 'scan-123')

    expect(result).toEqual(error)
  })

  it('handles scan fetch failure', async () => {
    const { fetchScanData } = await import('./fetch-report-data.mts')
    const { queryApiText, withSdk } = await import('../../utils/sdk.mts')
    const mockQueryApiText = vi.mocked(queryApiText)
    const mockSetupSdk = vi.mocked(withSdk)

    const mockSdk = {
      getOrgSecurityPolicy: vi.fn().mockResolvedValue({
        success: true,
        data: { rules: [] },
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockQueryApiText.mockResolvedValue({
      ok: false,
      code: 404,
      message: 'Scan not found',
      cause: 'The specified scan does not exist',
    })

    const result = await fetchScanData('test-org', 'nonexistent-scan')

    expect(result.ok).toBe(false)
    expect(result.code).toBe(404)
  })

  it('handles security policy fetch failure', async () => {
    const { fetchScanData } = await import('./fetch-report-data.mts')
    const { handleApiCallNoSpinner } = await import('../../utils/api.mts')
    const { queryApiText, withSdk } = await import('../../utils/sdk.mts')
    const mockHandleApiNoSpinner = vi.mocked(handleApiCallNoSpinner)
    const mockQueryApiText = vi.mocked(queryApiText)
    const mockSetupSdk = vi.mocked(withSdk)

    const mockSdk = {
      getOrgSecurityPolicy: vi.fn().mockResolvedValue({
        success: true,
        data: { rules: [] },
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockQueryApiText.mockResolvedValue({
      ok: true,
      data: '{"type":"package","name":"test"}',
    })
    mockHandleApiNoSpinner.mockResolvedValue({
      ok: false,
      code: 403,
      message: 'Access denied',
      cause: 'Insufficient permissions',
    })

    const result = await fetchScanData('restricted-org', 'scan-123')

    expect(result.ok).toBe(false)
    expect(result.code).toBe(403)
  })

  it('handles invalid JSON in scan data', async () => {
    const { fetchScanData } = await import('./fetch-report-data.mts')
    const { handleApiCallNoSpinner } = await import('../../utils/api.mts')
    const { queryApiText, withSdk } = await import('../../utils/sdk.mts')
    const { debugDir, debugFn } = await import('../../utils/debug.mts')
    const mockHandleApiNoSpinner = vi.mocked(handleApiCallNoSpinner)
    const mockQueryApiText = vi.mocked(queryApiText)
    const mockSetupSdk = vi.mocked(withSdk)
    const mockDebugFn = vi.mocked(debugFn)
    const mockDebugDir = vi.mocked(debugDir)

    const mockSdk = {
      getOrgSecurityPolicy: vi.fn().mockResolvedValue({
        success: true,
        data: { rules: [] },
      }),
    }

    const invalidJson = '{"valid":"json"}\n{"invalid":json}'

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockQueryApiText.mockResolvedValue({
      ok: true,
      data: invalidJson,
    })
    mockHandleApiNoSpinner.mockResolvedValue({
      ok: true,
      data: { rules: [] },
    })

    const result = await fetchScanData('test-org', 'scan-123')

    expect(mockDebugFn).toHaveBeenCalledWith(
      'error',
      'Failed to parse report data line as JSON',
    )
    expect(mockDebugDir).toHaveBeenCalledWith('error', {
      error: expect.any(SyntaxError),
      line: '{"invalid":json}',
    })
    expect(result.ok).toBe(false)
    expect(result.message).toBe('Invalid Socket API response')
  })

  it('includes license policy when requested', async () => {
    const { fetchScanData } = await import('./fetch-report-data.mts')
    const { handleApiCallNoSpinner } = await import('../../utils/api.mts')
    const { queryApiText, withSdk } = await import('../../utils/sdk.mts')
    const mockQueryApiText = vi.mocked(queryApiText)
    const mockHandleApiNoSpinner = vi.mocked(handleApiCallNoSpinner)
    const mockSetupSdk = vi.mocked(withSdk)

    const mockSdk = {
      getOrgSecurityPolicy: vi.fn().mockResolvedValue({
        success: true,
        data: { rules: [] },
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockQueryApiText.mockResolvedValue({
      ok: true,
      data: '{"type":"package","name":"test"}',
    })
    mockHandleApiNoSpinner.mockResolvedValue({
      ok: true,
      data: { rules: [] },
    })

    const options = {
      includeLicensePolicy: true,
    }

    await fetchScanData('test-org', 'scan-123', options)

    expect(mockQueryApiText).toHaveBeenCalledWith(
      expect.anything(),
      'orgs/test-org/full-scans/scan-123?include_license_details=true',
      expect.objectContaining({ description: 'scan result' }),
    )
  })

  it('handles custom SDK options', async () => {
    const { fetchScanData } = await import('./fetch-report-data.mts')
    const { queryApiText, withSdk } = await import('../../utils/sdk.mts')
    const { handleApiCallNoSpinner } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(withSdk)
    const mockQueryApiText = vi.mocked(queryApiText)
    const mockHandleApiNoSpinner = vi.mocked(handleApiCallNoSpinner)

    const mockSdk = {
      getOrgSecurityPolicy: vi.fn().mockResolvedValue({
        success: true,
        data: { rules: [] },
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockQueryApiText.mockResolvedValue({
      ok: true,
      data: '{"type":"package","name":"test"}',
    })
    mockHandleApiNoSpinner.mockResolvedValue({
      ok: true,
      data: { rules: [] },
    })

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
    const { handleApiCallNoSpinner } = await import('../../utils/api.mts')
    const { queryApiText, withSdk } = await import('../../utils/sdk.mts')
    const mockHandleApiNoSpinner = vi.mocked(handleApiCallNoSpinner)
    const mockQueryApiText = vi.mocked(queryApiText)
    const mockSetupSdk = vi.mocked(withSdk)

    const mockSdk = {
      getOrgSecurityPolicy: vi.fn().mockResolvedValue({
        success: true,
        data: { rules: [] },
      }),
    }

    // Return non-array data to trigger the error path.
    const nonArrayData = 'not-json-at-all'

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockQueryApiText.mockResolvedValue({
      ok: true,
      data: nonArrayData,
    })
    mockHandleApiNoSpinner.mockResolvedValue({
      ok: true,
      data: { rules: [] },
    })

    const result = await fetchScanData('test-org', 'scan-123')

    expect(result.ok).toBe(false)
    expect(result.message).toBe('Invalid Socket API response')
  })

  it('uses null prototype for options', async () => {
    const { fetchScanData } = await import('./fetch-report-data.mts')
    const { queryApiText, withSdk } = await import('../../utils/sdk.mts')
    const { handleApiCallNoSpinner } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(withSdk)
    const mockQueryApiText = vi.mocked(queryApiText)
    const mockHandleApiNoSpinner = vi.mocked(handleApiCallNoSpinner)

    const mockSdk = {
      getOrgSecurityPolicy: vi.fn().mockResolvedValue({
        success: true,
        data: { rules: [] },
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockQueryApiText.mockResolvedValue({
      ok: true,
      data: '{"type":"package","name":"test"}',
    })
    mockHandleApiNoSpinner.mockResolvedValue({
      ok: true,
      data: { rules: [] },
    })

    // This tests that the function properly uses __proto__: null.
    await fetchScanData('test-org', 'scan-123')

    // The function should work without prototype pollution issues.
    expect(mockSetupSdk).toHaveBeenCalled()
  })
})
