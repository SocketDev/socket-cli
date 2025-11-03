import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleScanView } from '../../../../src/src/commands/scan/handle-scan-view.mts'

// Mock the dependencies.
vi.mock('../../../../../src/commands/scan/fetch-scan.mts', () => ({
  fetchScan: vi.fn(),
}))
vi.mock('../../../../../src/commands/scan/output-scan-view.mts', () => ({
  outputScanView: vi.fn(),
}))

describe('handleScanView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches and outputs scan view successfully', async () => {
    const { fetchScan } = await import('../../../../../src/commands/scan/fetch-scan.mts')
    const { outputScanView } = await import('../../../../../src/commands/scan/output-scan-view.mts')

    const mockData = {
      ok: true,
      data: {
        id: 'scan-123',
        status: 'completed',
        results: {
          high: 2,
          medium: 5,
          low: 10,
        },
        createdAt: '2024-01-01T00:00:00Z',
      },
    }
    vi.mocked(fetchScan).mockResolvedValue(mockData)

    await handleScanView('test-org', 'scan-123', '/output/path.json', 'json')

    expect(fetchScan).toHaveBeenCalledWith('test-org', 'scan-123')
    expect(outputScanView).toHaveBeenCalledWith(
      mockData,
      'test-org',
      'scan-123',
      '/output/path.json',
      'json',
    )
  })

  it('handles fetch failure', async () => {
    const { fetchScan } = await import('../../../../../src/commands/scan/fetch-scan.mts')
    const { outputScanView } = await import('../../../../../src/commands/scan/output-scan-view.mts')

    const mockError = {
      ok: false,
      error: new Error('Scan not found'),
    }
    vi.mocked(fetchScan).mockResolvedValue(mockError)

    await handleScanView('test-org', 'invalid-scan', '', 'text')

    expect(fetchScan).toHaveBeenCalledWith('test-org', 'invalid-scan')
    expect(outputScanView).toHaveBeenCalledWith(
      mockError,
      'test-org',
      'invalid-scan',
      '',
      'text',
    )
  })

  it('handles markdown output', async () => {
    const { fetchScan } = await import('../../../../../src/commands/scan/fetch-scan.mts')
    const { outputScanView } = await import('../../../../../src/commands/scan/output-scan-view.mts')

    const mockData = {
      ok: true,
      data: {
        id: 'scan-456',
        status: 'in_progress',
        results: null,
      },
    }
    vi.mocked(fetchScan).mockResolvedValue(mockData)

    await handleScanView('org-2', 'scan-456', 'report.md', 'markdown')

    expect(outputScanView).toHaveBeenCalledWith(
      mockData,
      'org-2',
      'scan-456',
      'report.md',
      'markdown',
    )
  })

  it('handles empty file path', async () => {
    const { fetchScan } = await import('../../../../../src/commands/scan/fetch-scan.mts')
    const { outputScanView } = await import('../../../../../src/commands/scan/output-scan-view.mts')

    const mockData = {
      ok: true,
      data: { id: 'scan-789', status: 'pending' },
    }
    vi.mocked(fetchScan).mockResolvedValue(mockData)

    await handleScanView('my-org', 'scan-789', '', 'json')

    expect(outputScanView).toHaveBeenCalledWith(
      mockData,
      'my-org',
      'scan-789',
      '',
      'json',
    )
  })

  it('handles different scan statuses', async () => {
    const { fetchScan } = await import('../../../../../src/commands/scan/fetch-scan.mts')
    const { outputScanView } = await import('../../../../../src/commands/scan/output-scan-view.mts')

    const statuses = ['pending', 'in_progress', 'completed', 'failed']

    for (const status of statuses) {
      vi.mocked(fetchScan).mockResolvedValue({
        ok: true,
        data: { id: 'scan-test', status },
      })

      // eslint-disable-next-line no-await-in-loop
      await handleScanView('org', 'scan-test', 'output.json', 'json')

      expect(outputScanView).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status }),
        }),
        'org',
        'scan-test',
        'output.json',
        'json',
      )
    }
  })

  it('handles text output format', async () => {
    const { fetchScan } = await import('../../../../../src/commands/scan/fetch-scan.mts')
    const { outputScanView } = await import('../../../../../src/commands/scan/output-scan-view.mts')

    const mockData = {
      ok: true,
      data: {
        id: 'scan-999',
        status: 'completed',
        vulnerabilities: [],
      },
    }
    vi.mocked(fetchScan).mockResolvedValue(mockData)

    await handleScanView('test-org', 'scan-999', '-', 'text')

    expect(outputScanView).toHaveBeenCalledWith(
      mockData,
      'test-org',
      'scan-999',
      '-',
      'text',
    )
  })

  it('handles async errors', async () => {
    const { fetchScan } = await import('../../../../../src/commands/scan/fetch-scan.mts')

    vi.mocked(fetchScan).mockRejectedValue(new Error('Network error'))

    await expect(
      handleScanView('org', 'scan-id', 'file.json', 'json'),
    ).rejects.toThrow('Network error')
  })
})
