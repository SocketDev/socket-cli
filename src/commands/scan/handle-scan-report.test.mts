import { describe, expect, it, vi } from 'vitest'

import { handleScanReport } from './handle-scan-report.mts'

// Mock the dependencies
vi.mock('./fetch-report-data.mts', () => ({
  fetchScanData: vi.fn(),
}))

vi.mock('./output-scan-report.mts', () => ({
  outputScanReport: vi.fn(),
}))

describe('handleScanReport', () => {
  it('fetches scan data and outputs report successfully', async () => {
    const { fetchScanData } = await import('./fetch-report-data.mts')
    const { outputScanReport } = await import('./output-scan-report.mts')
    const mockFetch = vi.mocked(fetchScanData)
    const mockOutput = vi.mocked(outputScanReport)

    const mockScanData = {
      ok: true,
      data: {
        scan: {
          id: 'scan-123',
          status: 'completed',
          packages: [],
        },
        issues: [],
      },
    }
    mockFetch.mockResolvedValue(mockScanData)

    await handleScanReport({
      orgSlug: 'test-org',
      scanId: 'scan-123',
      includeLicensePolicy: true,
      outputKind: 'json',
      filepath: '/path/to/package.json',
      fold: 'none',
      reportLevel: 'high',
      short: false,
    })

    expect(mockFetch).toHaveBeenCalledWith('test-org', 'scan-123', {
      includeLicensePolicy: true,
    })
    expect(mockOutput).toHaveBeenCalledWith(mockScanData, {
      filepath: '/path/to/package.json',
      fold: 'none',
      scanId: 'scan-123',
      includeLicensePolicy: true,
      orgSlug: 'test-org',
      outputKind: 'json',
      reportLevel: 'high',
      short: false,
    })
  })

  it('handles fetch failure', async () => {
    const { fetchScanData } = await import('./fetch-report-data.mts')
    const { outputScanReport } = await import('./output-scan-report.mts')
    const mockFetch = vi.mocked(fetchScanData)
    const mockOutput = vi.mocked(outputScanReport)

    const mockError = {
      ok: false,
      error: 'Scan not found',
    }
    mockFetch.mockResolvedValue(mockError)

    await handleScanReport({
      orgSlug: 'test-org',
      scanId: 'invalid-scan',
      includeLicensePolicy: false,
      outputKind: 'text',
      filepath: 'package.json',
      fold: 'all',
      reportLevel: 'critical',
      short: true,
    })

    expect(mockFetch).toHaveBeenCalledWith('test-org', 'invalid-scan', {
      includeLicensePolicy: false,
    })
    expect(mockOutput).toHaveBeenCalledWith(mockError, expect.any(Object))
  })

  it('handles markdown output format', async () => {
    const { fetchScanData } = await import('./fetch-report-data.mts')
    const { outputScanReport } = await import('./output-scan-report.mts')
    const mockFetch = vi.mocked(fetchScanData)
    const mockOutput = vi.mocked(outputScanReport)

    mockFetch.mockResolvedValue({ ok: true, data: {} })

    await handleScanReport({
      orgSlug: 'test-org',
      scanId: 'scan-456',
      includeLicensePolicy: false,
      outputKind: 'markdown',
      filepath: 'yarn.lock',
      fold: 'duplicates',
      reportLevel: 'medium',
      short: false,
    })

    expect(mockOutput).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        outputKind: 'markdown',
      }),
    )
  })

  it('passes all configuration options correctly', async () => {
    const { fetchScanData } = await import('./fetch-report-data.mts')
    const { outputScanReport } = await import('./output-scan-report.mts')
    const mockFetch = vi.mocked(fetchScanData)
    const mockOutput = vi.mocked(outputScanReport)

    mockFetch.mockResolvedValue({ ok: true, data: {} })

    const config = {
      orgSlug: 'my-org',
      scanId: 'scan-789',
      includeLicensePolicy: true,
      outputKind: 'json' as const,
      filepath: 'pnpm-lock.yaml',
      fold: 'none' as const,
      reportLevel: 'low' as const,
      short: true,
    }

    await handleScanReport(config)

    expect(mockOutput).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining(config),
    )
  })

  it('handles text output with short format', async () => {
    const { fetchScanData } = await import('./fetch-report-data.mts')
    const { outputScanReport } = await import('./output-scan-report.mts')
    const mockFetch = vi.mocked(fetchScanData)
    const mockOutput = vi.mocked(outputScanReport)

    mockFetch.mockResolvedValue({
      ok: true,
      data: {
        scan: { id: 'scan-abc' },
        issues: [{ severity: 'high', package: 'vulnerable-pkg' }],
      },
    })

    await handleScanReport({
      orgSlug: 'test-org',
      scanId: 'scan-abc',
      includeLicensePolicy: false,
      outputKind: 'text',
      filepath: 'package-lock.json',
      fold: 'all',
      reportLevel: 'high',
      short: true,
    })

    expect(mockOutput).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        short: true,
        outputKind: 'text',
      }),
    )
  })
})
