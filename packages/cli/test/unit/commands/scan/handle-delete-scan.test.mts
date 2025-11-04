/**
 * Unit tests for handleDeleteScan.
 *
 * Purpose:
 * Tests the handler that orchestrates scan deletion. Validates scan cleanup and confirmation workflows.
 *
 * Test Coverage:
 * - Successful operation flow
 * - Fetch failure handling
 * - Input validation
 * - Output formatting delegation
 * - Error propagation
 *
 * Testing Approach:
 * Mocks fetch and output functions to isolate handler orchestration logic.
 * Validates proper data flow through the handler pipeline.
 *
 * Related Files:
 * - src/commands/handleDeleteScan.mts (implementation)
 */

import { describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../../../test/helpers/mocks.mts'
import { handleDeleteScan } from '../../../../src/commands/scan/handle-delete-scan.mts'

// Mock the dependencies.
const mockFetchDeleteOrgFullScan = vi.hoisted(() => vi.fn())
const mockOutputDeleteScan = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/commands/scan/fetch-delete-org-full-scan.mts', () => ({
  fetchDeleteOrgFullScan: mockFetchDeleteOrgFullScan,
}))

vi.mock('../../../../src/commands/scan/output-delete-scan.mts', () => ({
  outputDeleteScan: mockOutputDeleteScan,
}))

describe('handleDeleteScan', () => {
  it('deletes scan and outputs result successfully', async () => {
    const { outputDeleteScan } = await import('../../../../src/commands/scan/output-delete-scan.mts')
    const mockFetch = mockFetchDeleteOrgFullScan
    const mockOutput = mockOutputDeleteScan

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
    const { outputDeleteScan } = await import('../../../../src/commands/scan/output-delete-scan.mts')
    const mockFetch = mockFetchDeleteOrgFullScan
    const mockOutput = mockOutputDeleteScan

    const mockError = createErrorResult('Scan not found')
    mockFetch.mockResolvedValue(mockError)

    await handleDeleteScan('test-org', 'nonexistent-scan', 'text')

    expect(mockFetch).toHaveBeenCalledWith('test-org', 'nonexistent-scan')
    expect(mockOutput).toHaveBeenCalledWith(mockError, 'text')
  })

  it('handles markdown output format', async () => {
    const { outputDeleteScan } = await import('../../../../src/commands/scan/output-delete-scan.mts')
    const mockFetch = mockFetchDeleteOrgFullScan
    const mockOutput = mockOutputDeleteScan

    mockFetch.mockResolvedValue(createSuccessResult({}))

    await handleDeleteScan('my-org', 'scan-456', 'markdown')

    expect(mockOutput).toHaveBeenCalledWith(expect.any(Object), 'markdown')
  })

  it('handles different scan IDs', async () => {
    const mockFetch = mockFetchDeleteOrgFullScan

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
    const { outputDeleteScan } = await import('../../../../src/commands/scan/output-delete-scan.mts')
    const mockFetch = mockFetchDeleteOrgFullScan
    const mockOutput = mockOutputDeleteScan

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
