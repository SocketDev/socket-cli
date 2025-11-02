import { beforeEach, describe, expect, it, vi } from 'vitest'

import { determineOrgSlug } from '../socket/org-slug.mts'

// Mock dependencies.
const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  log: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

vi.mock('../../constants/config.mts', () => ({
  CONFIG_KEY_DEFAULT_ORG: 'defaultOrg',
}))

vi.mock('../../constants/socket.mts', () => ({
  V1_MIGRATION_GUIDE_URL: 'https://socket.dev/migration-guide',
}))

vi.mock('../config.mts', () => ({
  getConfigValueOrUndef: vi.fn(),
}))

vi.mock('../terminal/link.mts', () => ({
  webLink: vi.fn((_url, text) => text),
}))

vi.mock('../../commands/scan/suggest-org-slug.mts', () => ({
  suggestOrgSlug: vi.fn(),
}))

vi.mock('../../commands/scan/suggest-to-persist-orgslug.mts', () => ({
  suggestToPersistOrgSlug: vi.fn(),
}))

describe('determineOrgSlug', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('when org flag is provided', () => {
    it('uses org flag value over default', async () => {
      const { getConfigValueOrUndef } = vi.mocked(await import('../config.mts'))
      getConfigValueOrUndef.mockReturnValue('default-org')

      const result = await determineOrgSlug('flag-org', false, false)

      expect(result).toEqual(['flag-org', 'default-org'])
      expect(getConfigValueOrUndef).toHaveBeenCalledWith('defaultOrg')
    })

    it('returns org flag even when no default exists', async () => {
      const { getConfigValueOrUndef } = vi.mocked(await import('../config.mts'))
      getConfigValueOrUndef.mockReturnValue(undefined)

      const result = await determineOrgSlug('provided-org', false, false)

      expect(result).toEqual(['provided-org', undefined])
    })

    it('handles empty string org flag', async () => {
      const { getConfigValueOrUndef } = vi.mocked(await import('../config.mts'))
      vi.mocked(await import('@socketsecurity/lib/logger'))
      getConfigValueOrUndef.mockReturnValue(undefined)

      const result = await determineOrgSlug('', false, false)

      expect(result).toEqual(['', undefined])
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Note: This command requires an org slug because the Socket API endpoint does.',
      )
    })
  })

  describe('when using default org', () => {
    it('uses default org when no flag provided', async () => {
      const { getConfigValueOrUndef } = vi.mocked(await import('../config.mts'))
      getConfigValueOrUndef.mockReturnValue('configured-default-org')

      const result = await determineOrgSlug('', false, false)

      expect(result).toEqual([
        'configured-default-org',
        'configured-default-org',
      ])
    })

    it('handles numeric default org', async () => {
      const { getConfigValueOrUndef } = vi.mocked(await import('../config.mts'))
      getConfigValueOrUndef.mockReturnValue(12345 as any)

      const result = await determineOrgSlug('', false, false)

      expect(result).toEqual(['12345', 12345 as any])
    })
  })

  describe('non-interactive mode', () => {
    it('returns empty org and logs warnings when no org available', async () => {
      const { getConfigValueOrUndef } = vi.mocked(await import('../config.mts'))
      vi.mocked(await import('@socketsecurity/lib/logger'))
      const { webLink } = vi.mocked(await import('../terminal/link.mts'))
      getConfigValueOrUndef.mockReturnValue(undefined)

      const result = await determineOrgSlug('', false, false)

      expect(result).toEqual(['', undefined])
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Note: This command requires an org slug because the Socket API endpoint does.',
      )
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'It seems no default org was setup and the `--org` flag was not used.',
      )
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Additionally, `--no-interactive` was set so we can't ask for it.",
      )
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Note: When running in CI, you probably want to set the `--org` flag.',
      )
      expect(webLink).toHaveBeenCalledWith(
        'https://socket.dev/migration-guide',
        'v1 migration guide',
      )
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'This command will exit now because the org slug is required to proceed.',
      )
    })

    it('logs all migration guide messages', async () => {
      const { getConfigValueOrUndef } = vi.mocked(await import('../config.mts'))
      vi.mocked(await import('@socketsecurity/lib/logger'))
      getConfigValueOrUndef.mockReturnValue(undefined)

      await determineOrgSlug('', false, false)

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Since v1.0.0 the org _argument_ for all commands was dropped in favor of an',
      )
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'implicit default org setting, which will be setup when you run `socket login`.',
      )
    })
  })

  describe('interactive mode', () => {
    it('suggests org slug when no org available', async () => {
      const { getConfigValueOrUndef } = vi.mocked(await import('../config.mts'))
      const { suggestOrgSlug } = vi.mocked(
        await import('../../commands/scan/suggest-org-slug.mts'),
      )
      const { suggestToPersistOrgSlug } = vi.mocked(
        await import('../../commands/scan/suggest-to-persist-orgslug.mts'),
      )
      vi.mocked(await import('@socketsecurity/lib/logger'))

      getConfigValueOrUndef.mockReturnValue(undefined)
      suggestOrgSlug.mockResolvedValue('suggested-org')

      const result = await determineOrgSlug('', true, false)

      expect(result).toEqual(['suggested-org', undefined])
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Unable to determine the target org. Trying to auto-discover it now...',
      )
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Note: Run `socket login` to set a default org.',
      )
      expect(mockLogger.error).toHaveBeenCalledWith(
        '      Use the --org flag to override the default org.',
      )
      expect(suggestOrgSlug).toHaveBeenCalled()
      expect(suggestToPersistOrgSlug).toHaveBeenCalledWith('suggested-org')
    })

    it('handles null suggestion from suggestOrgSlug', async () => {
      const { getConfigValueOrUndef } = vi.mocked(await import('../config.mts'))
      const { suggestOrgSlug } = vi.mocked(
        await import('../../commands/scan/suggest-org-slug.mts'),
      )
      const { suggestToPersistOrgSlug } = vi.mocked(
        await import('../../commands/scan/suggest-to-persist-orgslug.mts'),
      )

      getConfigValueOrUndef.mockReturnValue(undefined)
      suggestOrgSlug.mockResolvedValue(null)

      const result = await determineOrgSlug('', true, false)

      expect(result).toEqual(['', undefined])
      expect(suggestOrgSlug).toHaveBeenCalled()
      expect(suggestToPersistOrgSlug).not.toHaveBeenCalled()
    })

    it('handles undefined suggestion from suggestOrgSlug', async () => {
      const { getConfigValueOrUndef } = vi.mocked(await import('../config.mts'))
      const { suggestOrgSlug } = vi.mocked(
        await import('../../commands/scan/suggest-org-slug.mts'),
      )
      const { suggestToPersistOrgSlug } = vi.mocked(
        await import('../../commands/scan/suggest-to-persist-orgslug.mts'),
      )

      getConfigValueOrUndef.mockReturnValue(undefined)
      suggestOrgSlug.mockResolvedValue(undefined as any)

      const result = await determineOrgSlug('', true, false)

      expect(result).toEqual(['', undefined])
      expect(suggestOrgSlug).toHaveBeenCalled()
      expect(suggestToPersistOrgSlug).not.toHaveBeenCalled()
    })

    it('skips auto-discovery in dry-run mode', async () => {
      const { getConfigValueOrUndef } = vi.mocked(await import('../config.mts'))
      const { suggestOrgSlug } = vi.mocked(
        await import('../../commands/scan/suggest-org-slug.mts'),
      )
      vi.mocked(await import('@socketsecurity/lib/logger'))

      getConfigValueOrUndef.mockReturnValue(undefined)

      const result = await determineOrgSlug('', true, true)

      expect(result).toEqual(['', undefined])
      expect(mockLogger.fail).toHaveBeenCalledWith(
        'Skipping auto-discovery of org in dry-run mode',
      )
      expect(suggestOrgSlug).not.toHaveBeenCalled()
    })
  })

  describe('edge cases', () => {
    it('handles boolean values for org flag', async () => {
      const { getConfigValueOrUndef } = vi.mocked(await import('../config.mts'))
      getConfigValueOrUndef.mockReturnValue('default')

      const result = await determineOrgSlug(true as any, false, false)

      expect(result).toEqual(['true', 'default'])
    })

    it('handles null values for org flag', async () => {
      const { getConfigValueOrUndef } = vi.mocked(await import('../config.mts'))
      getConfigValueOrUndef.mockReturnValue('default')

      const result = await determineOrgSlug(null as any, false, false)

      expect(result).toEqual(['default', 'default'])
    })

    it('handles undefined values for org flag', async () => {
      const { getConfigValueOrUndef } = vi.mocked(await import('../config.mts'))
      getConfigValueOrUndef.mockReturnValue('default')

      const result = await determineOrgSlug(undefined as any, false, false)

      expect(result).toEqual(['default', 'default'])
    })

    it('handles numeric values for org flag', async () => {
      const { getConfigValueOrUndef } = vi.mocked(await import('../config.mts'))
      getConfigValueOrUndef.mockReturnValue(undefined)

      const result = await determineOrgSlug(42 as any, false, false)

      expect(result).toEqual(['42', undefined])
    })

    it('handles empty string suggestion from suggestOrgSlug', async () => {
      const { getConfigValueOrUndef } = vi.mocked(await import('../config.mts'))
      const { suggestOrgSlug } = vi.mocked(
        await import('../../commands/scan/suggest-org-slug.mts'),
      )
      const { suggestToPersistOrgSlug } = vi.mocked(
        await import('../../commands/scan/suggest-to-persist-orgslug.mts'),
      )

      getConfigValueOrUndef.mockReturnValue(undefined)
      suggestOrgSlug.mockResolvedValue('')

      const result = await determineOrgSlug('', true, false)

      expect(result).toEqual(['', undefined])
      expect(suggestToPersistOrgSlug).not.toHaveBeenCalled()
    })

    it('preserves whitespace in org slug', async () => {
      const { getConfigValueOrUndef } = vi.mocked(await import('../config.mts'))
      getConfigValueOrUndef.mockReturnValue(undefined)

      const result = await determineOrgSlug('  org-with-spaces  ', false, false)

      expect(result).toEqual(['  org-with-spaces  ', undefined])
    })
  })

  describe('combination scenarios', () => {
    it('prioritizes org flag over everything else', async () => {
      const { getConfigValueOrUndef } = vi.mocked(await import('../config.mts'))
      const { suggestOrgSlug } = vi.mocked(
        await import('../../commands/scan/suggest-org-slug.mts'),
      )

      getConfigValueOrUndef.mockReturnValue('default-org')
      suggestOrgSlug.mockResolvedValue('suggested-org')

      const result = await determineOrgSlug('flag-org', true, false)

      expect(result).toEqual(['flag-org', 'default-org'])
      expect(suggestOrgSlug).not.toHaveBeenCalled()
    })

    it('uses default when available in interactive mode', async () => {
      const { getConfigValueOrUndef } = vi.mocked(await import('../config.mts'))
      const { suggestOrgSlug } = vi.mocked(
        await import('../../commands/scan/suggest-org-slug.mts'),
      )

      getConfigValueOrUndef.mockReturnValue('configured-org')

      const result = await determineOrgSlug('', true, false)

      expect(result).toEqual(['configured-org', 'configured-org'])
      expect(suggestOrgSlug).not.toHaveBeenCalled()
    })
  })
})
