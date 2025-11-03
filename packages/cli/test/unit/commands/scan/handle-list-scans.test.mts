import { describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../../src/helpers/mocks.mts'
import { handleListScans } from '../../../../src/handle-list-scans.mts'

// Mock the dependencies.
vi.mock('./fetch-list-scans.mts', () => ({
  fetchOrgFullScanList: vi.fn(),
}))

vi.mock('./output-list-scans.mts', () => ({
  outputListScans: vi.fn(),
}))

describe('handleListScans', () => {
  it('fetches and outputs scan list successfully', async () => {
    const { fetchOrgFullScanList } = await import('../../src/fetch-list-scans.mts')
    const { outputListScans } = await import('../../src/output-list-scans.mts')
    const mockFetch = vi.mocked(fetchOrgFullScanList)
    const mockOutput = vi.mocked(outputListScans)

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

    expect(mockFetch).toHaveBeenCalledWith({
      branch: 'main',
      direction: 'desc',
      from_time: '2025-01-01',
      orgSlug: 'test-org',
      page: 1,
      perPage: 20,
      repo: 'test-repo',
      sort: 'created_at',
    })
    expect(mockOutput).toHaveBeenCalledWith(mockData, 'json')
  })

  it('handles fetch failure', async () => {
    const { fetchOrgFullScanList } = await import('../../src/fetch-list-scans.mts')
    const { outputListScans } = await import('../../src/output-list-scans.mts')
    const mockFetch = vi.mocked(fetchOrgFullScanList)
    const mockOutput = vi.mocked(outputListScans)

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
    const { fetchOrgFullScanList } = await import('../../src/fetch-list-scans.mts')
    const mockFetch = vi.mocked(fetchOrgFullScanList)

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
    )
  })

  it('handles markdown output format', async () => {
    const { fetchOrgFullScanList } = await import('../../src/fetch-list-scans.mts')
    const { outputListScans } = await import('../../src/output-list-scans.mts')
    const mockFetch = vi.mocked(fetchOrgFullScanList)
    const mockOutput = vi.mocked(outputListScans)

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
    const { fetchOrgFullScanList } = await import('../../src/fetch-list-scans.mts')
    const mockFetch = vi.mocked(fetchOrgFullScanList)

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
        repo: 'specific-repo',
        from_time: '2025-01-15',
      }),
    )
  })
})
