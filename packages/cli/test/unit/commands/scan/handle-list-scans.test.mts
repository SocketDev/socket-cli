/**
 * Unit tests for handleListScans.
 *
 * Purpose:
 * Tests the handler that orchestrates scan listing. Validates pagination, filtering, and list output.
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
 * - src/commands/handleListScans.mts (implementation)
 */

import { describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../../../test/helpers/mocks.mts'
import { handleListScans } from '../../../../src/commands/scan/handle-list-scans.mts'

// Mock the dependencies.
const mockFetchOrgFullScanList = vi.hoisted(() => vi.fn())
const mockOutputListScans = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/commands/scan/fetch-list-scans.mts', () => ({
  fetchOrgFullScanList: mockFetchOrgFullScanList,
}))

vi.mock('../../../../src/commands/scan/output-list-scans.mts', () => ({
  outputListScans: mockOutputListScans,
}))

describe('handleListScans', () => {
  it('fetches and outputs scan list successfully', async () => {
    await import('../../../../src/commands/scan/fetch-list-scans.mts')
    await import('../../../../src/commands/scan/output-list-scans.mts')
    const mockFetch = mockFetchOrgFullScanList
    const mockOutput = mockOutputListScans

    const mockData = createSuccessResult([
      {
        id: 'scan-123',
        createdAt: '2025-01-01T00:00:00Z',
        status: 'completed',
        repository: 'test-repo',
        branch: 'main',
      },
      {
        id: 'scan-456',
        createdAt: '2025-01-02T00:00:00Z',
        status: 'in_progress',
        repository: 'another-repo',
        branch: 'develop',
      },
    ])
    mockFetch.mockResolvedValue(mockData)

    const params = {
      branch: 'main',
      direction: 'desc',
      from_time: '2025-01-01',
      orgSlug: 'test-org',
      outputKind: 'json' as const,
      page: 1,
      perPage: 20,
      repo: 'test-repo',
      sort: 'created_at',
    }

    await handleListScans(params)

    expect(mockFetch).toHaveBeenCalledWith(
      {
        branch: 'main',
        direction: 'desc',
        from_time: '2025-01-01',
        orgSlug: 'test-org',
        page: 1,
        perPage: 20,
        repo: 'test-repo',
        sort: 'created_at',
      },
      {
        commandPath: 'socket scan list',
      },
    )
    expect(mockOutput).toHaveBeenCalledWith(mockData, 'json')
  })

  it('handles fetch failure', async () => {
    await import('../../../../src/commands/scan/fetch-list-scans.mts')
    await import('../../../../src/commands/scan/output-list-scans.mts')
    const mockFetch = mockFetchOrgFullScanList
    const mockOutput = mockOutputListScans

    const mockError = createErrorResult('Unauthorized')
    mockFetch.mockResolvedValue(mockError)

    await handleListScans({
      branch: '',
      direction: 'asc',
      from_time: '',
      orgSlug: 'test-org',
      outputKind: 'text',
      page: 1,
      perPage: 10,
      repo: '',
      sort: 'updated_at',
    })

    expect(mockOutput).toHaveBeenCalledWith(mockError, 'text')
  })

  it('handles pagination parameters', async () => {
    await import('../../../../src/commands/scan/fetch-list-scans.mts')
    const mockFetch = mockFetchOrgFullScanList

    mockFetch.mockResolvedValue(createSuccessResult([]))

    await handleListScans({
      branch: '',
      direction: 'asc',
      from_time: '',
      orgSlug: 'test-org',
      outputKind: 'json',
      page: 5,
      perPage: 50,
      repo: '',
      sort: 'created_at',
    })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 5,
        perPage: 50,
      }),
      {
        commandPath: 'socket scan list',
      },
    )
  })

  it('handles markdown output format', async () => {
    await import('../../../../src/commands/scan/fetch-list-scans.mts')
    await import('../../../../src/commands/scan/output-list-scans.mts')
    const mockFetch = mockFetchOrgFullScanList
    const mockOutput = mockOutputListScans

    mockFetch.mockResolvedValue(createSuccessResult([]))

    await handleListScans({
      branch: 'main',
      direction: 'desc',
      from_time: '',
      orgSlug: 'my-org',
      outputKind: 'markdown',
      page: 1,
      perPage: 20,
      repo: 'my-repo',
      sort: 'created_at',
    })

    expect(mockOutput).toHaveBeenCalledWith(expect.any(Object), 'markdown')
  })

  it('handles filtering by branch and repository', async () => {
    await import('../../../../src/commands/scan/fetch-list-scans.mts')
    const mockFetch = mockFetchOrgFullScanList

    mockFetch.mockResolvedValue(createSuccessResult([]))

    await handleListScans({
      branch: 'feature/new-feature',
      direction: 'asc',
      from_time: '2025-01-15',
      orgSlug: 'test-org',
      outputKind: 'json',
      page: 1,
      perPage: 20,
      repo: 'specific-repo',
      sort: 'updated_at',
    })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        branch: 'feature/new-feature',
        from_time: '2025-01-15',
        repo: 'specific-repo',
      }),
      {
        commandPath: 'socket scan list',
      },
    )
  })
})
