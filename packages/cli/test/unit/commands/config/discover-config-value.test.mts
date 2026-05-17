/**
 * Unit tests for discoverConfigValue.
 *
 * Per-key auto-discovery for `socket config auto`. Covers every
 * branch in the dispatcher.
 *
 * Test Coverage:
 * - Unknown key → "Requested key is not a valid config key"
 * - apiBaseUrl / apiProxy / apiToken → returns hand-written advisory
 *   without an auto-discovery attempt
 * - defaultOrg without an API token → "No API token set" error
 * - defaultOrg with token + single org → returns that slug
 * - defaultOrg with token + multiple orgs → returns array
 * - defaultOrg with token + zero orgs → "Was unable to determine"
 * - defaultOrg with token + fetch failure → same error message
 * - enforcedOrgs same matrix
 * - test sentinel key → "congrats, you found the test key"
 *
 * Related Files:
 * - src/commands/config/discover-config-value.mts - Implementation
 * - src/util/config.mts - isSupportedConfigKey (mocked)
 * - src/util/socket/sdk.mts - hasDefaultApiToken (mocked)
 * - src/commands/organization/fetch-organization-list.mts - fetchOrganization (mocked)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockFetchOrganization,
  mockHasDefaultApiToken,
  mockIsSupportedConfigKey,
} = vi.hoisted(() => ({
  mockFetchOrganization: vi.fn(),
  mockHasDefaultApiToken: vi.fn(),
  mockIsSupportedConfigKey: vi.fn(),
}))

vi.mock('../../../../src/util/config.mts', () => ({
  isSupportedConfigKey: mockIsSupportedConfigKey,
}))

vi.mock('../../../../src/util/socket/sdk.mjs', () => ({
  hasDefaultApiToken: mockHasDefaultApiToken,
}))

vi.mock(
  '../../../../src/commands/organization/fetch-organization-list.mts',
  () => ({
    fetchOrganization: mockFetchOrganization,
  }),
)

const { discoverConfigValue } =
  await import('../../../../src/commands/config/discover-config-value.mts')

const orgFixture = (slugs: string[]) => ({
  ok: true as const,
  data: {
    organizations: slugs.map((slug, i) => ({
      id: `id-${i}`,
      slug,
      name: slug,
      image: '',
      plan: 'free',
    })),
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  mockIsSupportedConfigKey.mockReturnValue(true)
})

describe('discoverConfigValue', () => {
  it('rejects unknown keys', async () => {
    mockIsSupportedConfigKey.mockReturnValue(false)
    const result = await discoverConfigValue('not-a-real-key')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.cause).toContain('not a valid config key')
    }
  })

  it('returns advisory for apiBaseUrl', async () => {
    const result = await discoverConfigValue('apiBaseUrl')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.cause).toContain('unset')
    }
  })

  it('returns advisory for apiProxy', async () => {
    const result = await discoverConfigValue('apiProxy')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.cause).toContain('network administrator')
    }
  })

  it('returns advisory for apiToken', async () => {
    const result = await discoverConfigValue('apiToken')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.cause).toContain('socket login')
    }
  })

  describe('defaultOrg', () => {
    it('errors when no API token is set', async () => {
      mockHasDefaultApiToken.mockReturnValue(false)
      const result = await discoverConfigValue('defaultOrg')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.cause).toContain('No API token set')
      }
      expect(mockFetchOrganization).not.toHaveBeenCalled()
    })

    it('errors when fetchOrganization fails', async () => {
      mockHasDefaultApiToken.mockReturnValue(true)
      mockFetchOrganization.mockResolvedValue({
        ok: false,
        message: 'API down',
      })
      const result = await discoverConfigValue('defaultOrg')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.cause).toContain('Was unable to determine')
      }
    })

    it('errors when organizations list is empty', async () => {
      mockHasDefaultApiToken.mockReturnValue(true)
      mockFetchOrganization.mockResolvedValue(orgFixture([]))
      const result = await discoverConfigValue('defaultOrg')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.cause).toContain('Was unable to determine')
      }
    })

    it('returns the single slug as a string when only one org is present', async () => {
      mockHasDefaultApiToken.mockReturnValue(true)
      mockFetchOrganization.mockResolvedValue(orgFixture(['solo-org']))
      const result = await discoverConfigValue('defaultOrg')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBe('solo-org')
      }
    })

    it('returns an array when the token can access multiple orgs', async () => {
      mockHasDefaultApiToken.mockReturnValue(true)
      mockFetchOrganization.mockResolvedValue(orgFixture(['org-a', 'org-b']))
      const result = await discoverConfigValue('defaultOrg')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual(['org-a', 'org-b'])
      }
    })
  })

  describe('enforcedOrgs', () => {
    it('errors when no API token is set', async () => {
      mockHasDefaultApiToken.mockReturnValue(false)
      const result = await discoverConfigValue('enforcedOrgs')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.cause).toContain('must have a token')
      }
    })

    it('errors when fetchOrganization fails', async () => {
      mockHasDefaultApiToken.mockReturnValue(true)
      mockFetchOrganization.mockResolvedValue({
        ok: false,
        message: 'API down',
      })
      const result = await discoverConfigValue('enforcedOrgs')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.cause).toContain('Was unable to determine any orgs')
      }
    })

    it('errors when organizations list is empty', async () => {
      mockHasDefaultApiToken.mockReturnValue(true)
      mockFetchOrganization.mockResolvedValue(orgFixture([]))
      const result = await discoverConfigValue('enforcedOrgs')
      expect(result.ok).toBe(false)
    })

    it('returns the slug list when orgs are available', async () => {
      mockHasDefaultApiToken.mockReturnValue(true)
      mockFetchOrganization.mockResolvedValue(orgFixture(['x', 'y', 'z']))
      const result = await discoverConfigValue('enforcedOrgs')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual(['x', 'y', 'z'])
      }
    })
  })

  it('returns the easter-egg message for the test key', async () => {
    const result = await discoverConfigValue('test')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.cause).toContain('test key')
    }
  })

  it('falls through to "unreachable" for keys that pass isSupportedConfigKey but match no branch', async () => {
    // isSupportedConfigKey returns true (mocked) for an unknown key →
    // the dispatcher's final `unreachable?` branch is hit.
    mockIsSupportedConfigKey.mockReturnValue(true)
    const result = await discoverConfigValue('madeUpKey')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.cause).toBe('unreachable?')
    }
  })
})
