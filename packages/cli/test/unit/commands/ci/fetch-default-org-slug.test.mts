import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getDefaultOrgSlug } from '../../../../../src/commands/ci/fetch-default-org-slug.mts'

// Create mock functions with hoisting.
const { mockGetConfigValueOrUndef, mockFetchOrganization, mockEnv } = vi.hoisted(() => {
  const env = {
    SOCKET_CLI_ORG_SLUG: undefined,
  }
  return {
    mockGetConfigValueOrUndef: vi.fn(),
    mockFetchOrganization: vi.fn(),
    mockEnv: env,
  }
})

// Mock the dependencies.
vi.mock('../../../../../src/utils/config.mts', () => ({
  getConfigValueOrUndef: mockGetConfigValueOrUndef,
}))

vi.mock('../../../../../src/constants/env.mts', () => ({
  default: mockEnv,
}))

vi.mock('../../../../../src/commands/organization/fetch-organization-list.mts', () => ({
  fetchOrganization: mockFetchOrganization,
}))

describe('getDefaultOrgSlug', () => {
  const mockFn = mockGetConfigValueOrUndef
  const mockFetchFn = mockFetchOrganization
  const env = mockEnv

  beforeEach(() => {
    vi.clearAllMocks()
    env.SOCKET_CLI_ORG_SLUG = undefined
  })

  it('uses config defaultOrg when set', async () => {
    mockFn.mockReturnValue('config-org-slug')

    const result = await getDefaultOrgSlug()

    expect(result).toEqual({
      ok: true,
      data: 'config-org-slug',
    })
    expect(mockFn).toHaveBeenCalledWith('defaultOrg')
  })

  it('uses environment variable when no config', async () => {
    mockFn.mockReturnValue(undefined)
    env.SOCKET_CLI_ORG_SLUG = 'env-org-slug'

    const result = await getDefaultOrgSlug()

    expect(result).toEqual({
      ok: true,
      data: 'env-org-slug',
    })
  })

  it('fetches from API when no config or env', async () => {
    mockFn.mockReturnValue(undefined)
    env.SOCKET_CLI_ORG_SLUG = undefined

    mockFetchFn.mockResolvedValue({
      ok: true,
      data: {
        organizations: {
          'org-1': {
            id: 'org-1',
            name: 'Test Organization',
            slug: 'test-org',
          },
        },
      },
    })

    const result = await getDefaultOrgSlug()

    expect(result).toEqual({
      ok: true,
      message: 'Retrieved default org from server',
      data: 'Test Organization',
    })
  })

  it('returns error when fetchOrganization fails', async () => {
    mockFn.mockReturnValue(undefined)
    env.SOCKET_CLI_ORG_SLUG = undefined

    const error = {
      ok: false,
      code: 401,
      message: 'Unauthorized',
    }
    mockFetchFn.mockResolvedValue(error)

    const result = await getDefaultOrgSlug()

    expect(result).toEqual(error)
  })

  it('returns error when no organizations found', async () => {
    mockFn.mockReturnValue(undefined)
    env.SOCKET_CLI_ORG_SLUG = undefined

    mockFetchFn.mockResolvedValue({
      ok: true,
      data: {
        organizations: {},
      },
    })

    const result = await getDefaultOrgSlug()

    expect(result).toEqual({
      ok: false,
      message: 'Failed to establish identity',
      data: 'No organization associated with the Socket API token. Unable to continue.',
    })
  })

  it('returns error when organization has no name', async () => {
    mockFn.mockReturnValue(undefined)
    env.SOCKET_CLI_ORG_SLUG = undefined

    mockFetchFn.mockResolvedValue({
      ok: true,
      data: {
        organizations: {
          'org-1': {
            id: 'org-1',
            slug: 'org-slug',
            // Missing name field.
          },
        },
      },
    })

    const result = await getDefaultOrgSlug()

    expect(result).toEqual({
      ok: false,
      message: 'Failed to establish identity',
      data: 'Cannot determine the default organization for the API token. Unable to continue.',
    })
  })
})
