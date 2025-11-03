import { describe, expect, it, vi } from 'vitest'

import { setupTestEnvironment } from '../../../../../src/commands/../../../test/helpers/index.mts'
import { handleOrganizationList } from '../../../../src/src/commands/organization/handle-organization-list.mts'

// Mock the dependencies.

const mockFetchOrganization = vi.hoisted(() => vi.fn())
const mockOutputOrganizationList = vi.hoisted(() => vi.fn())
const mockDebug = vi.hoisted(() => vi.fn())
const mockDebugDir = vi.hoisted(() => vi.fn())
const mockDebugLog = vi.hoisted(() => vi.fn())
const mockIsDebug = vi.hoisted(() => vi.fn(())

vi.mock('../../../../../src/commands/organization/fetch-organization-list.mts', () => ({
  fetchOrganization: mockFetchOrganization,
}))

vi.mock('../../../../../src/commands/organization/output-organization-list.mts', () => ({
  outputOrganizationList: mockOutputOrganizationList,
}))

vi.mock('@socketsecurity/lib/debug', () => ({
  debug: mockDebug,
  debugDir: mockDebugDir,
  debugLog: mockDebugLog,
  isDebug: mockIsDebug => false),
}))

describe('handleOrganizationList', () => {
  setupTestEnvironment()

  it('fetches and outputs organization list successfully', async () => {
    const { fetchOrganization } = await import('../../../../../src/commands/organization/fetch-organization-list.mts')
    const { outputOrganizationList } = await import(
      './output-organization-list.mts'
    )
    const mockFetch = mockFetchOrganization
    const mockOutput = mockOutputOrganizationList

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
    const { fetchOrganization } = await import('../../../../../src/commands/organization/fetch-organization-list.mts')
    const { outputOrganizationList } = await import(
      './output-organization-list.mts'
    )
    const mockFetch = mockFetchOrganization
    const mockOutput = mockOutputOrganizationList

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
    const { fetchOrganization } = await import('../../../../../src/commands/organization/fetch-organization-list.mts')
    const { outputOrganizationList } = await import(
      './output-organization-list.mts'
    )
    const mockFetch = mockFetchOrganization
    const mockOutput = mockOutputOrganizationList

    mockFetch.mockResolvedValue({ ok: true, data: [] })

    await handleOrganizationList()

    expect(mockOutput).toHaveBeenCalledWith(expect.any(Object), 'text')
  })

  it('handles markdown output format', async () => {
    const { fetchOrganization } = await import('../../../../../src/commands/organization/fetch-organization-list.mts')
    const { outputOrganizationList } = await import(
      './output-organization-list.mts'
    )
    const mockFetch = mockFetchOrganization
    const mockOutput = mockOutputOrganizationList

    mockFetch.mockResolvedValue({ ok: true, data: [] })

    await handleOrganizationList('markdown')

    expect(mockOutput).toHaveBeenCalledWith(expect.any(Object), 'markdown')
  })

  it('passes debug messages correctly', async () => {
    const { debug, debugDir } = await import('@socketsecurity/lib/debug')
    const { fetchOrganization } = await import('../../../../../src/commands/organization/fetch-organization-list.mts')
    const mockDebug = mockDebug
    const mockDebugDir = mockDebugDir
    const mockFetch = mockFetchOrganization

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
    const { fetchOrganization } = await import('../../../../../src/commands/organization/fetch-organization-list.mts')
    const mockDebug = mockDebug
    const mockFetch = mockFetchOrganization

    mockFetch.mockResolvedValue({ ok: false, error: 'Network error' })

    await handleOrganizationList('text')

    expect(mockDebug).toHaveBeenCalledWith('Organization list fetch failed')
  })
})
