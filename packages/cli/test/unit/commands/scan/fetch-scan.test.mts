/**
 * Unit tests for fetchScan.
 *
 * Purpose: Tests fetching individual scan results via the Socket API. Scan
 * reads always go through the cached immutable-store endpoint
 * (`?cached=true`) and poll transparently while the server computes results.
 *
 * Testing Approach: Mocks the status-aware API query helper to simulate 200
 * (ready), 202 (processing), and error responses. The sleep helper is mocked
 * so polling loops run instantly.
 *
 * Related Files: - src/commands/scan/fetch-scan.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchScan } from '../../../../src/commands/scan/fetch-scan.mts'

// Mock the dependencies.
const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  log: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

const mockQueryApiSafeTextWithStatus = vi.hoisted(() => vi.fn())
const mockSleep = vi.hoisted(() => vi.fn(() => Promise.resolve()))
const mockDebug = vi.hoisted(() => vi.fn())
const mockDebugDir = vi.hoisted(() => vi.fn())
const mockIsDebug = vi.hoisted(() => vi.fn())
const mockGetDefaultApiToken = vi.hoisted(() => vi.fn(() => 'test-token'))

vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

vi.mock(import('../../../../src/util/socket/api.mjs'), () => ({
  queryApiSafeTextWithStatus: mockQueryApiSafeTextWithStatus,
}))

vi.mock(import('@socketsecurity/lib-stable/promises/timers'), () => ({
  sleep: mockSleep,
  yieldToEventLoop: vi.fn(() => Promise.resolve()),
}))

vi.mock(import('@socketsecurity/lib-stable/debug/output'), () => ({
  debug: mockDebug,
  debugDir: mockDebugDir,
}))
vi.mock(import('@socketsecurity/lib-stable/debug/namespace'), () => ({
  isDebug: mockIsDebug,
}))

vi.mock(import('../../../../src/util/socket/sdk.mts'), () => ({
  getDefaultApiToken: mockGetDefaultApiToken,
}))

function readyResponse(text: string) {
  return { ok: true, data: { status: 200, text } }
}

function processingResponse(scanId = 'scan-123') {
  return {
    ok: true,
    data: { status: 202, text: `{"status":"processing","id":"${scanId}"}` },
  }
}

describe('fetchScan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches cached scan results successfully', async () => {
    const mockScanData = [
      '{"type":"package","name":"lodash","version":"4.17.21"}',
      '{"type":"vulnerability","id":"CVE-2023-001","severity":"high"}',
      '{"type":"license","name":"MIT","approved":true}',
    ].join('\n')

    mockQueryApiSafeTextWithStatus.mockResolvedValue(
      readyResponse(mockScanData),
    )

    const result = await fetchScan('test-org', 'scan-123')

    expect(mockQueryApiSafeTextWithStatus).toHaveBeenCalledWith(
      'orgs/test-org/full-scans/scan-123?cached=true',
      'a scan',
    )
    expect(result.ok).toBe(true)
    expect(result.data).toEqual([
      { type: 'package', name: 'lodash', version: '4.17.21' },
      { type: 'vulnerability', id: 'CVE-2023-001', severity: 'high' },
      { type: 'license', name: 'MIT', approved: true },
    ])
  })

  it('polls on 202 until cached results are ready', async () => {
    mockQueryApiSafeTextWithStatus
      .mockResolvedValueOnce(processingResponse())
      .mockResolvedValueOnce(processingResponse())
      .mockResolvedValueOnce(readyResponse('{"type":"package","name":"ready"}'))

    const result = await fetchScan('test-org', 'scan-123')

    expect(mockQueryApiSafeTextWithStatus).toHaveBeenCalledTimes(3)
    expect(mockSleep).toHaveBeenCalledTimes(2)
    expect(result.ok).toBe(true)
    expect(result.data).toEqual([{ type: 'package', name: 'ready' }])
  })

  it('handles API call failure', async () => {
    const error = {
      ok: false,
      code: 404,
      message: 'Scan not found',
      cause: 'The specified scan does not exist',
    }
    mockQueryApiSafeTextWithStatus.mockResolvedValue(error)

    const result = await fetchScan('test-org', 'nonexistent-scan')

    expect(result).toEqual(error)
    expect(mockSleep).not.toHaveBeenCalled()
  })

  it('handles invalid JSON in scan data', async () => {
    const invalidJson = [
      '{"type":"package","name":"valid"}',
      '{"invalid":json}',
      '{"type":"another","name":"valid"}',
    ].join('\n')

    mockQueryApiSafeTextWithStatus.mockResolvedValue(readyResponse(invalidJson))

    const result = await fetchScan('test-org', 'scan-123')

    expect(mockDebug).toHaveBeenCalledWith(
      'Failed to parse scan result line as JSON',
    )
    expect(mockDebugDir).toHaveBeenCalledWith({
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
    mockQueryApiSafeTextWithStatus.mockResolvedValue(readyResponse(''))

    const result = await fetchScan('test-org', 'empty-scan')

    expect(result.ok).toBe(true)
    expect(result.data).toEqual([])
  })

  it('filters out empty lines but fails on invalid JSON', async () => {
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

    mockQueryApiSafeTextWithStatus.mockResolvedValue(
      readyResponse(dataWithEmptyLines),
    )

    const result = await fetchScan('test-org', 'scan-123')

    // This should fail because '   ' cannot be parsed as JSON.
    expect(result.ok).toBe(false)
    expect(result.message).toBe('Invalid Socket API response')
  })

  it('properly URL encodes scan ID', async () => {
    mockQueryApiSafeTextWithStatus.mockResolvedValue(
      readyResponse('{"type":"test"}'),
    )

    const specialCharsScanId = 'scan+with%special&chars/and?query=params'

    await fetchScan('test-org', specialCharsScanId)

    expect(mockQueryApiSafeTextWithStatus).toHaveBeenCalledWith(
      'orgs/test-org/full-scans/scan%2Bwith%25special%26chars%2Fand%3Fquery%3Dparams?cached=true',
      'a scan',
    )
  })

  it('handles different org slugs', async () => {
    mockQueryApiSafeTextWithStatus.mockResolvedValue(
      readyResponse('{"type":"test"}'),
    )

    const testCases = [
      'org-with-dashes',
      'simple_org',
      'org123',
      'long.org.name.with.dots',
    ]

    for (let i = 0, { length } = testCases; i < length; i += 1) {
      const orgSlug = testCases[i]
      await fetchScan(orgSlug, 'scan-123')

      expect(mockQueryApiSafeTextWithStatus).toHaveBeenCalledWith(
        `orgs/${orgSlug}/full-scans/scan-123?cached=true`,
        'a scan',
      )
    }
  })

  it('handles single line of JSON', async () => {
    const singleLineData =
      '{"type":"package","name":"single","version":"1.0.0"}'

    mockQueryApiSafeTextWithStatus.mockResolvedValue(
      readyResponse(singleLineData),
    )

    const result = await fetchScan('test-org', 'single-line-scan')

    expect(result.ok).toBe(true)
    expect(result.data).toEqual([
      { type: 'package', name: 'single', version: '1.0.0' },
    ])
  })
})
