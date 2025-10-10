import { describe, expect, it, vi } from 'vitest'

import { getDefaultOrgSlug } from './fetch-default-org-slug.mts'

// Mock the dependencies
vi.mock('../../utils/config.mts', () => ({
  getConfigValueOrUndef: vi.fn(),
}))

vi.mock('../../constants.mts', () => ({
  default: {
    ENV: {
      SOCKET_CLI_ORG_SLUG: undefined,
    },
  },
}))

vi.mock('../organization/fetch-organization-list.mts', () => ({
  fetchOrganization: vi.fn(),
}))

describe('getDefaultOrgSlug', () => {
  it('uses config defaultOrg when set', async () => {
    const { getConfigValueOrUndef } = await import('../../utils/config.mts')
    vi.mocked(getConfigValueOrUndef).mockReturnValue('config-org-slug')

    const result = await getDefaultOrgSlug()

    expect(result).toEqual({
      ok: true,
      data: 'config-org-slug',
    })
    expect(getConfigValueOrUndef).toHaveBeenCalledWith('defaultOrg')
  })

  it('uses environment variable when no config', async () => {
    const { getConfigValueOrUndef } = await import('../../utils/config.mts')
    vi.mocked(getConfigValueOrUndef).mockReturnValue(undefined)

    const constants = await import('../../constants.mts')
    constants.default.ENV.SOCKET_CLI_ORG_SLUG = 'env-org-slug'

    const result = await getDefaultOrgSlug()

    expect(result).toEqual({
      ok: true,
      data: 'env-org-slug',
    })
  })

  it('fetches from API when no config or env', async () => {
    const { getConfigValueOrUndef } = await import('../../utils/config.mts')
    const { fetchOrganization } = await import(
      '../organization/fetch-organization-list.mts'
    )

    vi.mocked(getConfigValueOrUndef).mockReturnValue(undefined)
    const constants = await import('../../constants.mts')
    constants.default.ENV.SOCKET_CLI_ORG_SLUG = undefined

    vi.mocked(fetchOrganization).mockResolvedValue({
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
    const { getConfigValueOrUndef } = await import('../../utils/config.mts')
    const { fetchOrganization } = await import(
      '../organization/fetch-organization-list.mts'
    )

    vi.mocked(getConfigValueOrUndef).mockReturnValue(undefined)
    const constants = await import('../../constants.mts')
    constants.default.ENV.SOCKET_CLI_ORG_SLUG = undefined

    const error = {
      ok: false,
      code: 401,
      message: 'Unauthorized',
    }
    vi.mocked(fetchOrganization).mockResolvedValue(error)

    const result = await getDefaultOrgSlug()

    expect(result).toEqual(error)
  })

  it('returns error when no organizations found', async () => {
    const { getConfigValueOrUndef } = await import('../../utils/config.mts')
    const { fetchOrganization } = await import(
      '../organization/fetch-organization-list.mts'
    )

    vi.mocked(getConfigValueOrUndef).mockReturnValue(undefined)
    const constants = await import('../../constants.mts')
    constants.default.ENV.SOCKET_CLI_ORG_SLUG = undefined

    vi.mocked(fetchOrganization).mockResolvedValue({
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
    const { getConfigValueOrUndef } = await import('../../utils/config.mts')
    const { fetchOrganization } = await import(
      '../organization/fetch-organization-list.mts'
    )

    vi.mocked(getConfigValueOrUndef).mockReturnValue(undefined)
    const constants = await import('../../constants.mts')
    constants.default.ENV.SOCKET_CLI_ORG_SLUG = undefined

    vi.mocked(fetchOrganization).mockResolvedValue({
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
