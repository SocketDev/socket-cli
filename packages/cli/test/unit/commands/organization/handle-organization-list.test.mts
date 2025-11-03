import { describe, expect, it, vi } from 'vitest'

import { setupTestEnvironment } from '../../../test/helpers/index.mts'
import { handleOrganizationList } from '../../../../../src/commands/organization/handle-organization-list.mts'

// Mock the dependencies.

vi.mock('../../../../../src/commands/organization/fetch-organization-list.mts', () => ({
  fetchOrganization: vi.fn(),
}))

vi.mock('../../../../../src/commands/organization/output-organization-list.mts', () => ({
  outputOrganizationList: vi.fn(),
}))

vi.mock('@socketsecurity/lib/debug', () => ({
  debug: vi.fn(),
  debugDir: vi.fn(),
  debugLog: vi.fn(),
  isDebug: vi.fn(() => false),
}))

describe('handleOrganizationList', () => {
  setupTestEnvironment()

  it('fetches and outputs organization list successfully', async () => {
    const { fetchOrganization } = await import('../../src/fetch-organization-list.mts')
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
    const { fetchOrganization } = await import('../../src/fetch-organization-list.mts')
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
    const { fetchOrganization } = await import('../../src/fetch-organization-list.mts')
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
    const { fetchOrganization } = await import('../../src/fetch-organization-list.mts')
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
    const { debug, debugDir } = await import('@socketsecurity/lib/debug')
    const { fetchOrganization } = await import('../../src/fetch-organization-list.mts')
    const mockDebug = vi.mocked(debug)
    const mockDebugDir = vi.mocked(debugDir)
    const mockFetch = vi.mocked(fetchOrganization)

    mockFetch.mockResolvedValue({ ok: true, data: [] })

    await handleOrganizationList('json')

    expect(mockDebug).toHaveBeenCalledWith('Fetching organization list')
    expect(mockDebugDir).toHaveBeenCalledWith({ outputKind: 'json' })
    expect(mockDebug).toHaveBeenCalledWith(
      'Organization list fetched successfully',
    )
  })

  it('handles error case with debug messages', async () => {
    const { debug } = await import('@socketsecurity/lib/debug')
    const { fetchOrganization } = await import('../../src/fetch-organization-list.mts')
    const mockDebug = vi.mocked(debug)
    const mockFetch = vi.mocked(fetchOrganization)

    mockFetch.mockResolvedValue({ ok: false, error: 'Network error' })

    await handleOrganizationList('text')

    expect(mockDebug).toHaveBeenCalledWith('Organization list fetch failed')
  })
})
