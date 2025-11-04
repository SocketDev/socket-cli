import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setupTestEnvironment } from '../../../helpers/index.mts'
import { handleOrganizationList } from '../../../../src/commands/organization/handle-organization-list.mts'
import { fetchOrganization } from '../../../../src/commands/organization/fetch-organization-list.mts'
import { outputOrganizationList } from '../../../../src/commands/organization/output-organization-list.mts'

// Mock the dependencies.
const mockFetchOrganization = vi.hoisted(() => vi.fn())
const mockOutputOrganizationList = vi.hoisted(() => vi.fn())
const mockDebug = vi.hoisted(() => vi.fn())
const mockDebugDir = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/commands/organization/fetch-organization-list.mts', () => ({
  fetchOrganization: mockFetchOrganization,
}))

vi.mock('../../../../src/commands/organization/output-organization-list.mts', () => ({
  outputOrganizationList: mockOutputOrganizationList,
}))

vi.mock('@socketsecurity/lib/debug', () => ({
  debug: mockDebug,
  debugDir: mockDebugDir,
}))

describe('handleOrganizationList', () => {
  setupTestEnvironment()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches and outputs organization list successfully', async () => {
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
    mockFetchOrganization.mockResolvedValue(mockData)

    await handleOrganizationList('json')

    expect(fetchOrganization).toHaveBeenCalled()
    expect(outputOrganizationList).toHaveBeenCalledWith(mockData, 'json')
  })

  it('handles fetch failure', async () => {
    const mockError = {
      ok: false,
      error: 'Unauthorized',
    }
    mockFetchOrganization.mockResolvedValue(mockError)

    await handleOrganizationList('text')

    expect(fetchOrganization).toHaveBeenCalled()
    expect(outputOrganizationList).toHaveBeenCalledWith(mockError, 'text')
  })

  it('uses default text output format', async () => {
    mockFetchOrganization.mockResolvedValue({ ok: true, data: [] })

    await handleOrganizationList()

    expect(outputOrganizationList).toHaveBeenCalledWith(expect.any(Object), 'text')
  })

  it('handles markdown output format', async () => {
    mockFetchOrganization.mockResolvedValue({ ok: true, data: [] })

    await handleOrganizationList('markdown')

    expect(outputOrganizationList).toHaveBeenCalledWith(expect.any(Object), 'markdown')
  })

  it('passes debug messages correctly', async () => {
    mockFetchOrganization.mockResolvedValue({ ok: true, data: [] })

    await handleOrganizationList('json')

    expect(mockDebug).toHaveBeenCalledWith('Fetching organization list')
    expect(mockDebugDir).toHaveBeenCalledWith({ outputKind: 'json' })
    expect(mockDebug).toHaveBeenCalledWith(
      'Organization list fetched successfully',
    )
  })

  it('handles error case with debug messages', async () => {
    mockFetchOrganization.mockResolvedValue({ ok: false, error: 'Network error' })

    await handleOrganizationList('text')

    expect(mockDebug).toHaveBeenCalledWith('Organization list fetch failed')
  })
})
