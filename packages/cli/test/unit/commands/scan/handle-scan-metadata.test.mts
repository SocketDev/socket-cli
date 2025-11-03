import { describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../test/helpers/mocks.mts'
import { handleOrgScanMetadata } from '../../../../../src/commands/scan/handle-scan-metadata.mts'

// Mock the dependencies.
vi.mock('../../../../../src/commands/scan/fetch-scan-metadata.mts', () => ({
  fetchScanMetadata: vi.fn(),
}))

vi.mock('../../../../../src/commands/scan/output-scan-metadata.mts', () => ({
  outputScanMetadata: vi.fn(),
}))

describe('handleOrgScanMetadata', () => {
  it('fetches and outputs scan metadata successfully', async () => {
    const { fetchScanMetadata } = await import('../../src/fetch-scan-metadata.mts')
    const { outputScanMetadata } = await import('../../src/output-scan-metadata.mts')
    const mockFetch = vi.mocked(fetchScanMetadata)
    const mockOutput = vi.mocked(outputScanMetadata)

    const mockMetadata = createSuccessResult({
      scanId: 'scan-123',
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T01:00:00Z',
      status: 'completed',
      packageManager: 'npm',
      repository: 'test-repo',
      branch: 'main',
      commit: 'abc123def456',
    })
    mockFetch.mockResolvedValue(mockMetadata)

    await handleOrgScanMetadata('test-org', 'scan-123', 'json')

    expect(mockFetch).toHaveBeenCalledWith('test-org', 'scan-123')
    expect(mockOutput).toHaveBeenCalledWith(mockMetadata, 'scan-123', 'json')
  })

  it('handles fetch failure', async () => {
    const { fetchScanMetadata } = await import('../../src/fetch-scan-metadata.mts')
    const { outputScanMetadata } = await import('../../src/output-scan-metadata.mts')
    const mockFetch = vi.mocked(fetchScanMetadata)
    const mockOutput = vi.mocked(outputScanMetadata)

    const mockError = createErrorResult('Scan not found')
    mockFetch.mockResolvedValue(mockError)

    await handleOrgScanMetadata('test-org', 'invalid-scan', 'text')

    expect(mockFetch).toHaveBeenCalledWith('test-org', 'invalid-scan')
    expect(mockOutput).toHaveBeenCalledWith(mockError, 'invalid-scan', 'text')
  })

  it('handles markdown output format', async () => {
    const { fetchScanMetadata } = await import('../../src/fetch-scan-metadata.mts')
    const { outputScanMetadata } = await import('../../src/output-scan-metadata.mts')
    const mockFetch = vi.mocked(fetchScanMetadata)
    const mockOutput = vi.mocked(outputScanMetadata)

    mockFetch.mockResolvedValue(
      createSuccessResult({
        scanId: 'scan-456',
        status: 'in_progress',
      }),
    )

    await handleOrgScanMetadata('my-org', 'scan-456', 'markdown')

    expect(mockOutput).toHaveBeenCalledWith(
      expect.any(Object),
      'scan-456',
      'markdown',
    )
  })

  it('handles different scan IDs', async () => {
    const { fetchScanMetadata } = await import('../../src/fetch-scan-metadata.mts')
    const { outputScanMetadata } = await import('../../src/output-scan-metadata.mts')
    const mockFetch = vi.mocked(fetchScanMetadata)
    const _mockOutput = vi.mocked(outputScanMetadata)

    const scanIds = [
      'scan-abc123',
      'scan-def456',
      'scan-ghi789',
      'uuid-1234-5678-9012-3456',
    ]

    for (const scanId of scanIds) {
      mockFetch.mockResolvedValue(createSuccessResult({}))
      // eslint-disable-next-line no-await-in-loop
      await handleOrgScanMetadata('test-org', scanId, 'json')
      expect(mockFetch).toHaveBeenCalledWith('test-org', scanId)
    }
  })

  it('handles text output with detailed metadata', async () => {
    const { fetchScanMetadata } = await import('../../src/fetch-scan-metadata.mts')
    const { outputScanMetadata } = await import('../../src/output-scan-metadata.mts')
    const mockFetch = vi.mocked(fetchScanMetadata)
    const mockOutput = vi.mocked(outputScanMetadata)

    mockFetch.mockResolvedValue(
      createSuccessResult({
        scanId: 'scan-xyz',
        createdAt: '2025-01-01T10:00:00Z',
        status: 'completed',
        packagesScanned: 150,
        vulnerabilitiesFound: 3,
        duration: '45s',
      }),
    )

    await handleOrgScanMetadata('production-org', 'scan-xyz', 'text')

    expect(mockOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          packagesScanned: 150,
        }),
      }),
      'scan-xyz',
      'text',
    )
  })
})
