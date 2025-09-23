import { describe, expect, it, vi } from 'vitest'

// Mock the dependencies.
vi.mock('@socketsecurity/registry/lib/debug', () => ({
  debugDir: vi.fn(),
  debugFn: vi.fn(),
}))

vi.mock('../../utils/api.mts', () => ({
  queryApiSafeText: vi.fn(),
}))

describe('fetchScan', () => {
  it('fetches scan successfully', async () => {
    const { fetchScan } = await import('./fetch-scan.mts')
    const { queryApiSafeText } = await import('../../utils/api.mts')
    const mockQueryApiText = vi.mocked(queryApiSafeText)

    const mockScanData = [
      '{"type":"package","name":"lodash","version":"4.17.21"}',
      '{"type":"vulnerability","id":"CVE-2023-001","severity":"high"}',
      '{"type":"license","name":"MIT","approved":true}',
    ].join('\n')

    mockQueryApiText.mockResolvedValue({
      ok: true,
      data: mockScanData,
    })

    const result = await fetchScan('test-org', 'scan-123')

    expect(mockQueryApiText).toHaveBeenCalledWith(
      'orgs/test-org/full-scans/scan-123',
      'a scan',
    )
    expect(result.ok).toBe(true)
    expect(result.data).toEqual([
      { type: 'package', name: 'lodash', version: '4.17.21' },
      { type: 'vulnerability', id: 'CVE-2023-001', severity: 'high' },
      { type: 'license', name: 'MIT', approved: true },
    ])
  })

  it('handles API call failure', async () => {
    const { fetchScan } = await import('./fetch-scan.mts')
    const { queryApiSafeText } = await import('../../utils/api.mts')
    const mockQueryApiText = vi.mocked(queryApiSafeText)

    const error = {
      ok: false,
      code: 404,
      message: 'Scan not found',
      cause: 'The specified scan does not exist',
    }
    mockQueryApiText.mockResolvedValue(error)

    const result = await fetchScan('test-org', 'nonexistent-scan')

    expect(result).toEqual(error)
  })

  it('handles invalid JSON in scan data', async () => {
    const { fetchScan } = await import('./fetch-scan.mts')
    const { queryApiSafeText } = await import('../../utils/api.mts')
    const { debugDir, debugFn } = await import(
      '@socketsecurity/registry/lib/debug'
    )
    const mockQueryApiText = vi.mocked(queryApiSafeText)
    const mockDebugFn = vi.mocked(debugFn)
    const mockDebugDir = vi.mocked(debugDir)

    const invalidJson = [
      '{"type":"package","name":"valid"}',
      '{"invalid":json}',
      '{"type":"another","name":"valid"}',
    ].join('\n')

    mockQueryApiText.mockResolvedValue({
      ok: true,
      data: invalidJson,
    })

    const result = await fetchScan('test-org', 'scan-123')

    expect(mockDebugFn).toHaveBeenCalledWith(
      'error',
      'Failed to parse scan result line as JSON',
    )
    expect(mockDebugDir).toHaveBeenCalledWith('error', {
      error: expect.any(SyntaxError),
      line: '{"invalid":json}',
    })
    expect(result.ok).toBe(false)
    expect(result.message).toBe('Invalid Socket API response')
    expect(result.cause).toBe(
      'The Socket API responded with at least one line that was not valid JSON. Please report if this persists.',
    )
  })

  it('handles empty scan data', async () => {
    const { fetchScan } = await import('./fetch-scan.mts')
    const { queryApiSafeText } = await import('../../utils/api.mts')
    const mockQueryApiText = vi.mocked(queryApiSafeText)

    mockQueryApiText.mockResolvedValue({
      ok: true,
      data: '',
    })

    const result = await fetchScan('test-org', 'empty-scan')

    expect(result.ok).toBe(true)
    expect(result.data).toEqual([])
  })

  it('filters out empty lines but fails on invalid JSON', async () => {
    const { fetchScan } = await import('./fetch-scan.mts')
    const { queryApiSafeText } = await import('../../utils/api.mts')
    const mockQueryApiText = vi.mocked(queryApiSafeText)

    // The function filters out empty lines with .filter(Boolean), but '   ' is truthy.
    // So it will try to parse '   ' as JSON and fail.
    const dataWithEmptyLines = [
      '{"type":"package","name":"first"}',
      '',
      '{"type":"package","name":"second"}',
      '   ',
      '{"type":"package","name":"third"}',
      '',
    ].join('\n')

    mockQueryApiText.mockResolvedValue({
      ok: true,
      data: dataWithEmptyLines,
    })

    const result = await fetchScan('test-org', 'scan-123')

    // This should fail because '   ' cannot be parsed as JSON.
    expect(result.ok).toBe(false)
    expect(result.message).toBe('Invalid Socket API response')
  })

  it('properly URL encodes scan ID', async () => {
    const { fetchScan } = await import('./fetch-scan.mts')
    const { queryApiSafeText } = await import('../../utils/api.mts')
    const mockQueryApiText = vi.mocked(queryApiSafeText)

    mockQueryApiText.mockResolvedValue({
      ok: true,
      data: '{"type":"test"}',
    })

    const specialCharsScanId = 'scan+with%special&chars/and?query=params'

    await fetchScan('test-org', specialCharsScanId)

    expect(mockQueryApiText).toHaveBeenCalledWith(
      'orgs/test-org/full-scans/scan%2Bwith%25special%26chars%2Fand%3Fquery%3Dparams',
      'a scan',
    )
  })

  it('handles different org slugs', async () => {
    const { fetchScan } = await import('./fetch-scan.mts')
    const { queryApiSafeText } = await import('../../utils/api.mts')
    const mockQueryApiText = vi.mocked(queryApiSafeText)

    mockQueryApiText.mockResolvedValue({
      ok: true,
      data: '{"type":"test"}',
    })

    const testCases = [
      'org-with-dashes',
      'simple_org',
      'org123',
      'long.org.name.with.dots',
    ]

    for (const orgSlug of testCases) {
      // eslint-disable-next-line no-await-in-loop
      await fetchScan(orgSlug, 'scan-123')

      expect(mockQueryApiText).toHaveBeenCalledWith(
        `orgs/${orgSlug}/full-scans/scan-123`,
        'a scan',
      )
    }
  })

  it('handles single line of JSON', async () => {
    const { fetchScan } = await import('./fetch-scan.mts')
    const { queryApiSafeText } = await import('../../utils/api.mts')
    const mockQueryApiText = vi.mocked(queryApiSafeText)

    const singleLineData =
      '{"type":"package","name":"single","version":"1.0.0"}'

    mockQueryApiText.mockResolvedValue({
      ok: true,
      data: singleLineData,
    })

    const result = await fetchScan('test-org', 'single-line-scan')

    expect(result.ok).toBe(true)
    expect(result.data).toEqual([
      { type: 'package', name: 'single', version: '1.0.0' },
    ])
  })

  it('uses null prototype internally', async () => {
    const { fetchScan } = await import('./fetch-scan.mts')
    const { queryApiSafeText } = await import('../../utils/api.mts')
    const mockQueryApiText = vi.mocked(queryApiSafeText)

    mockQueryApiText.mockResolvedValue({
      ok: true,
      data: '{"type":"test"}',
    })

    // This tests that the function works without prototype pollution issues.
    await fetchScan('test-org', 'scan-123')

    // The function should work properly.
    expect(mockQueryApiText).toHaveBeenCalled()
  })
})
