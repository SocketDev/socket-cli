/**
 * Unit tests for repository list command.
 *
 * Tests the command that lists repositories in an organization.
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
const mockHandleListRepos = vi.hoisted(() => vi.fn())
const mockDetermineOrgSlug = vi.hoisted(() =>
  vi.fn().mockResolvedValue(['test-org', 'test-org']),
)
const mockHasDefaultApiToken = vi.hoisted(() => vi.fn().mockReturnValue(false))

vi.mock('../../../../src/commands/repository/handle-list-repos.mts', () => ({
  handleListRepos: mockHandleListRepos,
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
const { cmdRepositoryList } =
  await import('../../../../src/commands/repository/cmd-repository-list.mts')

describe('cmd-repository-list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdRepositoryList.description).toBe(
        'List repositories in an organization',
      )
    })

    it('should not be hidden', () => {
      expect(cmdRepositoryList.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-repository-list.mts' }
    const context = { parentName: 'socket repository' }

    it('should support --dry-run flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryList.run(['--dry-run'], importMeta, context)

      expect(mockHandleListRepos).not.toHaveBeenCalled()
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should fail without Socket API token', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(false)

      await cmdRepositoryList.run(['--no-interactive'], importMeta, context)

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleListRepos).not.toHaveBeenCalled()
    })

    it('should fail without org slug', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['', ''])
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryList.run(['--no-interactive'], importMeta, context)

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleListRepos).not.toHaveBeenCalled()
    })

    it('should call handleListRepos with default parameters', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryList.run(['--no-interactive'], importMeta, context)

      expect(mockHandleListRepos).toHaveBeenCalledWith({
        all: false,
        direction: 'desc',
        orgSlug: 'test-org',
        outputKind: 'text',
        page: 1,
        perPage: 30,
        sort: 'created_at',
      })
    })

    it('should pass --all flag to handleListRepos', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryList.run(
        ['--all', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleListRepos).toHaveBeenCalledWith({
        all: true,
        direction: 'desc',
        orgSlug: 'test-org',
        outputKind: 'text',
        page: 1,
        perPage: 30,
        sort: 'created_at',
      })
    })

    it('should pass --page flag to handleListRepos', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryList.run(
        ['--page', '2', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleListRepos).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 2,
        }),
      )
    })

    it('should pass --per-page flag to handleListRepos', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryList.run(
        ['--per-page', '50', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleListRepos).toHaveBeenCalledWith(
        expect.objectContaining({
          perPage: 50,
        }),
      )
    })

    it('should pass --sort flag to handleListRepos', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryList.run(
        ['--sort', 'updated_at', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleListRepos).toHaveBeenCalledWith(
        expect.objectContaining({
          sort: 'updated_at',
        }),
      )
    })

    it('should pass --direction flag to handleListRepos', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryList.run(
        ['--direction', 'asc', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleListRepos).toHaveBeenCalledWith(
        expect.objectContaining({
          direction: 'asc',
        }),
      )
    })

    it('should fail with invalid direction value', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryList.run(
        ['--direction', 'invalid', '--no-interactive'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleListRepos).not.toHaveBeenCalled()
    })

    it('should pass --org flag to determineOrgSlug', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['custom-org', 'custom-org'])
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryList.run(
        ['--org', 'custom-org', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith(
        'custom-org',
        false,
        false,
      )
      expect(mockHandleListRepos).toHaveBeenCalledWith(
        expect.objectContaining({
          orgSlug: 'custom-org',
        }),
      )
    })

    it('should pass --json flag to handleListRepos', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryList.run(
        ['--json', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleListRepos).toHaveBeenCalledWith(
        expect.objectContaining({
          outputKind: 'json',
        }),
      )
    })

    it('should pass --markdown flag to handleListRepos', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryList.run(
        ['--markdown', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleListRepos).toHaveBeenCalledWith(
        expect.objectContaining({
          outputKind: 'markdown',
        }),
      )
    })

    it('should fail when both --json and --markdown flags are set', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryList.run(
        ['--json', '--markdown', '--no-interactive'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleListRepos).not.toHaveBeenCalled()
    })

    it('should show query parameters in dry-run mode with default values', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryList.run(['--dry-run'], importMeta, context)

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('[DryRun]: Would fetch repositories'),
      )
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('organization: test-org'),
      )
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('sort: created_at'),
      )
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('direction: desc'),
      )
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('page: 1'),
      )
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('perPage: 30'),
      )
    })

    it('should show query parameters in dry-run mode with --all flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryList.run(['--dry-run', '--all'], importMeta, context)

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('all: true'),
      )
    })

    it('should pass interactive flag to determineOrgSlug', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryList.run(['--interactive'], importMeta, context)

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('', true, false)
    })

    it('should handle all pagination and sorting flags together', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryList.run(
        [
          '--page',
          '3',
          '--per-page',
          '100',
          '--sort',
          'name',
          '--direction',
          'asc',
          '--no-interactive',
        ],
        importMeta,
        context,
      )

      expect(mockHandleListRepos).toHaveBeenCalledWith({
        all: false,
        direction: 'asc',
        orgSlug: 'test-org',
        outputKind: 'text',
        page: 3,
        perPage: 100,
        sort: 'name',
      })
    })
  })
})
