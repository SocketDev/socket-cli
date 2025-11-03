import { describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../../src/helpers/mocks.mts'
import { handleDeleteScan } from '../../../../src/src/handle-delete-scan.mts'

// Mock the dependencies.
vi.mock('./fetch-delete-org-full-scan.mts', () => ({
  fetchDeleteOrgFullScan: vi.fn(),
}))

vi.mock('./output-delete-scan.mts', () => ({
  outputDeleteScan: vi.fn(),
}))

describe('handleDeleteScan', () => {
  it('deletes scan and outputs result successfully', async () => {
    const { fetchDeleteOrgFullScan } = await import(
      './fetch-delete-org-full-scan.mts'
    )
    const { outputDeleteScan } = await import('./output-delete-scan.mts')
    const mockFetch = vi.mocked(fetchDeleteOrgFullScan)
    const mockOutput = vi.mocked(outputDeleteScan)

    const mockResult = createSuccessResult({
      deleted: true,
      scanId: 'scan-123',
      deletedAt: '2025-01-01T00:00:00Z',
    })
    mockFetch.mockResolvedValue(mockResult)

    await handleDeleteScan('test-org', 'scan-123', 'json')

    expect(mockFetch).toHaveBeenCalledWith('test-org', 'scan-123')
    expect(mockOutput).toHaveBeenCalledWith(mockResult, 'json')
  })

  it('handles deletion failure', async () => {
    const { fetchDeleteOrgFullScan } = await import(
      './fetch-delete-org-full-scan.mts'
    )
    const { outputDeleteScan } = await import('./output-delete-scan.mts')
    const mockFetch = vi.mocked(fetchDeleteOrgFullScan)
    const mockOutput = vi.mocked(outputDeleteScan)

    const mockError = createErrorResult('Scan not found')
    mockFetch.mockResolvedValue(mockError)

    await handleDeleteScan('test-org', 'nonexistent-scan', 'text')

    expect(mockFetch).toHaveBeenCalledWith('test-org', 'nonexistent-scan')
    expect(mockOutput).toHaveBeenCalledWith(mockError, 'text')
  })

  it('handles markdown output format', async () => {
    const { fetchDeleteOrgFullScan } = await import(
      './fetch-delete-org-full-scan.mts'
    )
    const { outputDeleteScan } = await import('./output-delete-scan.mts')
    const mockFetch = vi.mocked(fetchDeleteOrgFullScan)
    const mockOutput = vi.mocked(outputDeleteScan)

    mockFetch.mockResolvedValue(createSuccessResult({}))

    await handleDeleteScan('my-org', 'scan-456', 'markdown')

    expect(mockOutput).toHaveBeenCalledWith(expect.any(Object), 'markdown')
  })

  it('handles different scan IDs', async () => {
    const { fetchDeleteOrgFullScan } = await import(
      './fetch-delete-org-full-scan.mts'
    )
    const mockFetch = vi.mocked(fetchDeleteOrgFullScan)

    mockFetch.mockResolvedValue(createSuccessResult({}))

    const scanIds = [
      'scan-123',
      'scan-abc-def',
      'uuid-1234-5678-9012-3456',
      'scan_with_underscore',
    ]

    for (const scanId of scanIds) {
      // eslint-disable-next-line no-await-in-loop
      await handleDeleteScan('test-org', scanId, 'json')
      expect(mockFetch).toHaveBeenCalledWith('test-org', scanId)
    }
  })

  it('handles text output format', async () => {
    const { fetchDeleteOrgFullScan } = await import(
      './fetch-delete-org-full-scan.mts'
    )
    const { outputDeleteScan } = await import('./output-delete-scan.mts')
    const mockFetch = vi.mocked(fetchDeleteOrgFullScan)
    const mockOutput = vi.mocked(outputDeleteScan)

    mockFetch.mockResolvedValue(
      createSuccessResult({
        deleted: true,
        message: 'Scan successfully deleted',
      }),
    )

    await handleDeleteScan('production-org', 'scan-to-delete', 'text')

    expect(mockOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({ deleted: true }),
      }),
      'text',
    )
  })
})
