import { beforeEach, describe, expect, it, vi } from 'vitest'

import { determineOrgSlug } from '../../../../../src/utils/socket/org-slug.mts'
import { overrideCachedConfig } from '../../../../../src/utils/config.mts'

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

const mockWebLink = vi.hoisted(() => vi.fn((_url: string, text: string) => text))
const mockSuggestOrgSlug = vi.hoisted(() => vi.fn())
const mockSuggestToPersistOrgSlug = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/constants/config.mjs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    CONFIG_KEY_DEFAULT_ORG: 'defaultOrg',
  }
})

vi.mock('../../../../src/constants/socket.mts', () => ({
  V1_MIGRATION_GUIDE_URL: 'https://socket.dev/migration-guide',
}))

vi.mock('../../../../src/utils/terminal/link.mjs', () => ({
  webLink: mockWebLink,
}))

vi.mock('../../../../src/commands/scan/suggest-org-slug.mjs', () => ({
  suggestOrgSlug: mockSuggestOrgSlug,
}))

vi.mock('../../../../src/commands/scan/suggest-to-persist-orgslug.mjs', () => ({
  suggestToPersistOrgSlug: mockSuggestToPersistOrgSlug,
}))

describe('determineOrgSlug', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    overrideCachedConfig('{}')
  })

  describe('when org flag is provided', () => {
    it('uses org flag value over default', async () => {
      overrideCachedConfig('{"defaultOrg": "default-org"}')

      const result = await determineOrgSlug('flag-org', false, false)

      expect(result).toEqual(['flag-org', 'default-org'])
    })

    it('returns org flag even when no default exists', async () => {
      overrideCachedConfig('{}')

      const result = await determineOrgSlug('provided-org', false, false)

      expect(result).toEqual(['provided-org', undefined])
    })

    it('handles empty string org flag', async () => {
      overrideCachedConfig('{}')

      const result = await determineOrgSlug('', false, false)

      expect(result).toEqual(['', undefined])
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Note: This command requires an org slug because the Socket API endpoint does.',
      )
    })
  })

  describe('when using default org', () => {
    it('uses default org when no flag provided', async () => {
      overrideCachedConfig('{"defaultOrg": "configured-default-org"}')

      const result = await determineOrgSlug('', false, false)

      expect(result).toEqual([
        'configured-default-org',
        'configured-default-org',
      ])
    })

    it('handles numeric default org', async () => {
      overrideCachedConfig('{"defaultOrg": 12345}')

      const result = await determineOrgSlug('', false, false)

      expect(result).toEqual(['12345', 12345 as any])
    })
  })

  describe('non-interactive mode', () => {
    it('returns empty org and logs warnings when no org available', async () => {
      overrideCachedConfig('{}')

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
      expect(mockWebLink).toHaveBeenCalledWith(
        'https://socket.dev/migration-guide',
        'v1 migration guide',
      )
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'This command will exit now because the org slug is required to proceed.',
      )
    })

    it('logs all migration guide messages', async () => {
      overrideCachedConfig('{}')

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
      overrideCachedConfig('{}')
      mockSuggestOrgSlug.mockResolvedValue('suggested-org')

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
      expect(mockSuggestOrgSlug).toHaveBeenCalled()
      expect(mockSuggestToPersistOrgSlug).toHaveBeenCalledWith('suggested-org')
    })

    it('handles null suggestion from suggestOrgSlug', async () => {
      overrideCachedConfig('{}')
      mockSuggestOrgSlug.mockResolvedValue(null)

      const result = await determineOrgSlug('', true, false)

      expect(result).toEqual(['', undefined])
      expect(mockSuggestOrgSlug).toHaveBeenCalled()
      expect(mockSuggestToPersistOrgSlug).not.toHaveBeenCalled()
    })

    it('handles undefined suggestion from suggestOrgSlug', async () => {
      overrideCachedConfig('{}')
      mockSuggestOrgSlug.mockResolvedValue(undefined as any)

      const result = await determineOrgSlug('', true, false)

      expect(result).toEqual(['', undefined])
      expect(mockSuggestOrgSlug).toHaveBeenCalled()
      expect(mockSuggestToPersistOrgSlug).not.toHaveBeenCalled()
    })

    it('skips auto-discovery in dry-run mode', async () => {
      overrideCachedConfig('{}')

      const result = await determineOrgSlug('', true, true)

      expect(result).toEqual(['', undefined])
      expect(mockLogger.fail).toHaveBeenCalledWith(
        'Skipping auto-discovery of org in dry-run mode',
      )
      expect(mockSuggestOrgSlug).not.toHaveBeenCalled()
    })
  })

  describe('edge cases', () => {
    it('handles boolean values for org flag', async () => {
      overrideCachedConfig('{"defaultOrg": "default"}')

      const result = await determineOrgSlug(true as any, false, false)

      expect(result).toEqual(['true', 'default'])
    })

    it('handles null values for org flag', async () => {
      overrideCachedConfig('{"defaultOrg": "default"}')

      const result = await determineOrgSlug(null as any, false, false)

      expect(result).toEqual(['default', 'default'])
    })

    it('handles undefined values for org flag', async () => {
      overrideCachedConfig('{"defaultOrg": "default"}')

      const result = await determineOrgSlug(undefined as any, false, false)

      expect(result).toEqual(['default', 'default'])
    })

    it('handles numeric values for org flag', async () => {
      overrideCachedConfig('{}')

      const result = await determineOrgSlug(42 as any, false, false)

      expect(result).toEqual(['42', undefined])
    })

    it('handles empty string suggestion from suggestOrgSlug', async () => {
      overrideCachedConfig('{}')
      mockSuggestOrgSlug.mockResolvedValue('')

      const result = await determineOrgSlug('', true, false)

      expect(result).toEqual(['', undefined])
      expect(mockSuggestToPersistOrgSlug).not.toHaveBeenCalled()
    })

    it('preserves whitespace in org slug', async () => {
      overrideCachedConfig('{}')

      const result = await determineOrgSlug('  org-with-spaces  ', false, false)

      expect(result).toEqual(['  org-with-spaces  ', undefined])
    })
  })

  describe('combination scenarios', () => {
    it('prioritizes org flag over everything else', async () => {
      overrideCachedConfig('{"defaultOrg": "default-org"}')
      mockSuggestOrgSlug.mockResolvedValue('suggested-org')

      const result = await determineOrgSlug('flag-org', true, false)

      expect(result).toEqual(['flag-org', 'default-org'])
      expect(mockSuggestOrgSlug).not.toHaveBeenCalled()
    })

    it('uses default when available in interactive mode', async () => {
      overrideCachedConfig('{"defaultOrg": "configured-org"}')

      const result = await determineOrgSlug('', true, false)

      expect(result).toEqual(['configured-org', 'configured-org'])
      expect(mockSuggestOrgSlug).not.toHaveBeenCalled()
    })
  })
})
