import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getDefaultOrgSlug } from './fetch-default-org-slug.mts'
import { fetchOrganization } from '../organization/fetch-organization-list.mts'
import { getConfigValueOrUndef } from '../../utils/config.mts'

vi.mock('../organization/fetch-organization-list.mts', () => ({
  fetchOrganization: vi.fn(),
}))
vi.mock('../../utils/config.mts', () => ({
  getConfigValueOrUndef: vi.fn(() => undefined),
}))
// Keep SOCKET_CLI_ORG_SLUG unset so the resolver falls through to the API path.
vi.mock('../../constants.mts', () => ({
  default: { ENV: {} },
}))

describe('getDefaultOrgSlug', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getConfigValueOrUndef).mockReturnValue(undefined)
  })

  it('resolves the org slug (not the display name) from the API', async () => {
    vi.mocked(fetchOrganization).mockResolvedValue({
      ok: true,
      data: {
        organizations: [
          {
            id: 'org-id',
            name: 'Display Name',
            image: null,
            plan: 'free',
            slug: 'my-org-slug',
          },
        ],
      },
    } as any)

    const result = await getDefaultOrgSlug()

    expect(result.ok).toBe(true)
    // Regression guard: must be the URL-safe slug, never the display name.
    expect(result.ok && result.data).toBe('my-org-slug')
  })

  it('resolves the slug even when the display name is null', async () => {
    vi.mocked(fetchOrganization).mockResolvedValue({
      ok: true,
      data: {
        organizations: [
          {
            id: 'org-id',
            name: null,
            image: null,
            plan: 'free',
            slug: 'slug-only',
          },
        ],
      },
    } as any)

    const result = await getDefaultOrgSlug()

    expect(result.ok).toBe(true)
    expect(result.ok && result.data).toBe('slug-only')
  })

  it('prefers the defaultOrg config value without calling the API', async () => {
    vi.mocked(getConfigValueOrUndef).mockReturnValue('configured-org')

    const result = await getDefaultOrgSlug()

    expect(result.ok).toBe(true)
    expect(result.ok && result.data).toBe('configured-org')
    expect(fetchOrganization).not.toHaveBeenCalled()
  })

  it('fails when the API returns no organizations', async () => {
    vi.mocked(fetchOrganization).mockResolvedValue({
      ok: true,
      data: { organizations: [] },
    } as any)

    const result = await getDefaultOrgSlug()

    expect(result.ok).toBe(false)
  })
})
