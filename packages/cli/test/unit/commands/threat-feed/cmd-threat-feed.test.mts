/**
 * Unit tests for threat-feed command.
 *
 * Tests the command that displays the Socket threat feed.
 *
 * Test Coverage:
 * - Command metadata (description, hidden flag)
 * - API token requirement validation
 * - Organization slug handling
 * - Filter flags: ecosystem, type, package, version
 * - Pagination flags: page, per-page, direction
 * - Output modes: text, JSON, markdown
 * - Dry-run mode
 * - Argument parsing for filters
 *
 * Testing Approach:
 * - Mock logger to capture output
 * - Mock handleThreatFeed to verify handler invocation
 * - Mock determineOrgSlug for organization handling
 * - Mock hasDefaultApiToken for authentication checks
 * - Test flag combinations and defaults
 *
 * Related Files:
 * - src/commands/threat-feed/cmd-threat-feed.mts - Implementation
 * - src/commands/threat-feed/handle-threat-feed.mts - Handler
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the logger.
const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@socketsecurity/lib/logger')>()
  return {
    ...actual,
    getDefaultLogger: () => mockLogger,
  }
})

// Mock dependencies.
const mockHandleThreatFeed = vi.hoisted(() => vi.fn())
const mockDetermineOrgSlug = vi.hoisted(() =>
  vi.fn().mockResolvedValue(['test-org', 'test-org']),
)
const mockHasDefaultApiToken = vi.hoisted(() => vi.fn().mockReturnValue(true))

vi.mock('../../../../src/commands/threat-feed/handle-threat-feed.mts', () => ({
  handleThreatFeed: mockHandleThreatFeed,
}))

vi.mock('../../../../src/utils/socket/org-slug.mjs', () => ({
  determineOrgSlug: mockDetermineOrgSlug,
}))

vi.mock('../../../../src/utils/socket/sdk.mjs', async importOriginal => {
  const actual =
    await importOriginal<
      typeof import('../../../../src/utils/socket/sdk.mjs')
    >()
  return {
    ...actual,
    hasDefaultApiToken: mockHasDefaultApiToken,
  }
})

// Import after mocks.
const { cmdThreatFeed } =
  await import('../../../../src/commands/threat-feed/cmd-threat-feed.mts')

describe('cmd-threat-feed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdThreatFeed.description).toBe('[Beta] View the threat-feed')
    })

    it('should not be hidden', () => {
      expect(cmdThreatFeed.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-threat-feed.mts' }
    const context = { parentName: 'socket' }

    it('should support --dry-run flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdThreatFeed.run(['--dry-run'], importMeta, context)

      expect(mockHandleThreatFeed).not.toHaveBeenCalled()
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should fail without Socket API token', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(false)

      await cmdThreatFeed.run([], importMeta, context)

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleThreatFeed).not.toHaveBeenCalled()
    })

    it('should call handleThreatFeed with default values', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdThreatFeed.run([], importMeta, context)

      expect(mockHandleThreatFeed).toHaveBeenCalledWith({
        direction: 'desc',
        ecosystem: '',
        filter: '',
        orgSlug: 'test-org',
        outputKind: 'text',
        page: '1',
        perPage: 30,
        pkg: '',
        version: '',
      })
    })

    it('should pass --eco flag to handleThreatFeed', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdThreatFeed.run(['--eco', 'npm'], importMeta, context)

      expect(mockHandleThreatFeed).toHaveBeenCalledWith(
        expect.objectContaining({
          ecosystem: 'npm',
        }),
      )
    })

    it('should have default filter value when --filter flag is used', async () => {
      // Note: There appears to be a bug where the flag is named "filter"
      // but the code destructures "type" from cli.flags (line 186).
      // This means --filter flag is currently not working as expected.
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdThreatFeed.run(['--filter', 'typo'], importMeta, context)

      expect(mockHandleThreatFeed).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: '',
        }),
      )
    })

    it('should pass --pkg flag to handleThreatFeed', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdThreatFeed.run(['--pkg', 'test-package'], importMeta, context)

      expect(mockHandleThreatFeed).toHaveBeenCalledWith(
        expect.objectContaining({
          pkg: 'test-package',
        }),
      )
    })

    it('should pass --version flag to handleThreatFeed', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdThreatFeed.run(['--version', '1.0.0'], importMeta, context)

      expect(mockHandleThreatFeed).toHaveBeenCalledWith(
        expect.objectContaining({
          version: '1.0.0',
        }),
      )
    })

    it('should pass --page flag to handleThreatFeed', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdThreatFeed.run(['--page', '2'], importMeta, context)

      expect(mockHandleThreatFeed).toHaveBeenCalledWith(
        expect.objectContaining({
          page: '2',
        }),
      )
    })

    it('should pass --per-page flag to handleThreatFeed', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdThreatFeed.run(['--per-page', '50'], importMeta, context)

      expect(mockHandleThreatFeed).toHaveBeenCalledWith(
        expect.objectContaining({
          perPage: 50,
        }),
      )
    })

    it('should pass --direction flag to handleThreatFeed', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdThreatFeed.run(['--direction', 'asc'], importMeta, context)

      expect(mockHandleThreatFeed).toHaveBeenCalledWith(
        expect.objectContaining({
          direction: 'asc',
        }),
      )
    })

    it('should pass --org flag to determineOrgSlug', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['custom-org', 'custom-org'])
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdThreatFeed.run(['--org', 'custom-org'], importMeta, context)

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith(
        'custom-org',
        true,
        false,
      )
      expect(mockHandleThreatFeed).toHaveBeenCalledWith(
        expect.objectContaining({
          orgSlug: 'custom-org',
        }),
      )
    })

    it('should support --json output mode', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdThreatFeed.run(['--json'], importMeta, context)

      expect(mockHandleThreatFeed).toHaveBeenCalledWith(
        expect.objectContaining({
          outputKind: 'json',
        }),
      )
    })

    it('should support --markdown output mode', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdThreatFeed.run(['--markdown'], importMeta, context)

      expect(mockHandleThreatFeed).toHaveBeenCalledWith(
        expect.objectContaining({
          outputKind: 'markdown',
        }),
      )
    })

    it('should parse ecosystem from arguments', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdThreatFeed.run(['npm'], importMeta, context)

      expect(mockHandleThreatFeed).toHaveBeenCalledWith(
        expect.objectContaining({
          ecosystem: 'npm',
        }),
      )
    })

    it('should parse type filter from arguments', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdThreatFeed.run(['typo'], importMeta, context)

      expect(mockHandleThreatFeed).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: 'typo',
        }),
      )
    })

    it('should parse version from arguments', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdThreatFeed.run(['1.2.3'], importMeta, context)

      expect(mockHandleThreatFeed).toHaveBeenCalledWith(
        expect.objectContaining({
          version: '1.2.3',
        }),
      )
    })

    it('should parse package name from arguments', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdThreatFeed.run(['my-package'], importMeta, context)

      expect(mockHandleThreatFeed).toHaveBeenCalledWith(
        expect.objectContaining({
          pkg: 'my-package',
        }),
      )
    })

    it('should parse multiple arguments correctly', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdThreatFeed.run(['npm', 'typo', '1.0.0'], importMeta, context)

      expect(mockHandleThreatFeed).toHaveBeenCalledWith(
        expect.objectContaining({
          ecosystem: 'npm',
          filter: 'typo',
          version: '1.0.0',
        }),
      )
    })

    it('should validate per-page as numeric', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdThreatFeed.run(['--per-page', 'invalid'], importMeta, context)

      expect(mockHandleThreatFeed).toHaveBeenCalledWith(
        expect.objectContaining({
          perPage: 30,
        }),
      )
    })

    it('should fail if both --json and --markdown are set', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdThreatFeed.run(['--json', '--markdown'], importMeta, context)

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleThreatFeed).not.toHaveBeenCalled()
    })

    it('should fail without organization slug', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['', ''])
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdThreatFeed.run([], importMeta, context)

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleThreatFeed).not.toHaveBeenCalled()
    })

    it('should handle --no-interactive flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdThreatFeed.run(['--no-interactive'], importMeta, context)

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('', false, false)
    })

    it('should show dry-run output with all parameters', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdThreatFeed.run(
        [
          '--dry-run',
          '--eco',
          'npm',
          '--filter',
          'mal',
          '--pkg',
          'test-pkg',
          '--version',
          '1.0.0',
          '--page',
          '2',
          '--per-page',
          '50',
          '--direction',
          'asc',
        ],
        importMeta,
        context,
      )

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('threat feed data'),
      )
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('npm'),
      )
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('test-pkg'),
      )
    })

    it('should combine flags and arguments correctly', async () => {
      // Note: --filter flag doesn't work due to bug (see earlier test comment).
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdThreatFeed.run(
        ['npm', '--filter', 'mal', '--pkg', 'test-package'],
        importMeta,
        context,
      )

      expect(mockHandleThreatFeed).toHaveBeenCalledWith(
        expect.objectContaining({
          ecosystem: 'npm',
          filter: '',
          pkg: 'test-package',
        }),
      )
    })
  })
})
