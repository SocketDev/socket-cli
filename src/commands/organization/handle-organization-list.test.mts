import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleOrganizationList } from './handle-organization-list.mts'

// Mock the dependencies.

vi.mock('./fetch-organization-list.mts', () => ({
  fetchOrganization: vi.fn(),
}))

vi.mock('./output-organization-list.mts', () => ({
  outputOrganizationList: vi.fn(),
}))

vi.mock('../../utils/debug.mts', () => ({
  debugDir: vi.fn(),
  debugFn: vi.fn(),
  debugLog: vi.fn(),
  isDebug: vi.fn(() => false),
}))

describe('handleOrganizationList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches and outputs organization list successfully', async () => {
    const { fetchOrganization } = await import('./fetch-organization-list.mts')
    const { outputOrganizationList } = await import(
      './output-organization-list.mts'
    )
    const mockFetch = vi.mocked(fetchOrganization)
    const mockOutput = vi.mocked(outputOrganizationList)

    const mockData = {
      ok: true,
      data: [
        {
          id: 'org-123',
          name: 'Test Organization',
          slug: 'test-org',
          plan: 'pro',
        },
        {
          id: 'org-456',
          name: 'Another Org',
          slug: 'another-org',
          plan: 'enterprise',
        },
      ],
    }
    mockFetch.mockResolvedValue(mockData)

    await handleOrganizationList('json')

    expect(mockFetch).toHaveBeenCalled()
    expect(mockOutput).toHaveBeenCalledWith(mockData, 'json')
  })

  it('handles fetch failure', async () => {
    const { fetchOrganization } = await import('./fetch-organization-list.mts')
    const { outputOrganizationList } = await import(
      './output-organization-list.mts'
    )
    const mockFetch = vi.mocked(fetchOrganization)
    const mockOutput = vi.mocked(outputOrganizationList)

    const mockError = {
      ok: false,
      error: 'Unauthorized',
    }
    mockFetch.mockResolvedValue(mockError)

    await handleOrganizationList('text')

    expect(mockFetch).toHaveBeenCalled()
    expect(mockOutput).toHaveBeenCalledWith(mockError, 'text')
  })

  it('uses default text output format', async () => {
    const { fetchOrganization } = await import('./fetch-organization-list.mts')
    const { outputOrganizationList } = await import(
      './output-organization-list.mts'
    )
    const mockFetch = vi.mocked(fetchOrganization)
    const mockOutput = vi.mocked(outputOrganizationList)

    mockFetch.mockResolvedValue({ ok: true, data: [] })

    await handleOrganizationList()

    expect(mockOutput).toHaveBeenCalledWith(expect.any(Object), 'text')
  })

  it('handles markdown output format', async () => {
    const { fetchOrganization } = await import('./fetch-organization-list.mts')
    const { outputOrganizationList } = await import(
      './output-organization-list.mts'
    )
    const mockFetch = vi.mocked(fetchOrganization)
    const mockOutput = vi.mocked(outputOrganizationList)

    mockFetch.mockResolvedValue({ ok: true, data: [] })

    await handleOrganizationList('markdown')

    expect(mockOutput).toHaveBeenCalledWith(expect.any(Object), 'markdown')
  })

  it('passes debug messages correctly', async () => {
    const { debugDir, debugFn } = await import('../../utils/debug.mts')
    const { fetchOrganization } = await import('./fetch-organization-list.mts')
    const mockDebugDir = vi.mocked(debugDir)
    const mockDebugFn = vi.mocked(debugFn)
    const mockFetch = vi.mocked(fetchOrganization)

    mockFetch.mockResolvedValue({ ok: true, data: [] })

    await handleOrganizationList('json')

    expect(mockDebugFn).toHaveBeenCalledWith(
      'notice',
      'Fetching organization list',
    )
    expect(mockDebugDir).toHaveBeenCalledWith('inspect', {
      outputKind: 'json',
    })
    expect(mockDebugFn).toHaveBeenCalledWith(
      'notice',
      'Organization list fetched successfully',
    )
  })

  it('handles error case with debug messages', async () => {
    const { debugFn } = await import('../../utils/debug.mts')
    const { fetchOrganization } = await import('./fetch-organization-list.mts')
    const mockDebugFn = vi.mocked(debugFn)
    const mockFetch = vi.mocked(fetchOrganization)

    mockFetch.mockResolvedValue({ ok: false, error: 'Network error' })

    await handleOrganizationList('text')

    expect(mockDebugFn).toHaveBeenCalledWith(
      'notice',
      'Organization list fetch failed',
    )
  })
})
