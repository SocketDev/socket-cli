/**
 * Unit tests for repository delete command.
 *
 * Tests the command that deletes a repository in an organization.
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
const mockHandleDeleteRepo = vi.hoisted(() => vi.fn())
const mockDetermineOrgSlug = vi.hoisted(() =>
  vi.fn().mockResolvedValue(['test-org', 'test-org']),
)
const mockHasDefaultApiToken = vi.hoisted(() => vi.fn().mockReturnValue(false))

vi.mock('../../../../src/commands/repository/handle-delete-repo.mts', () => ({
  handleDeleteRepo: mockHandleDeleteRepo,
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
const { cmdRepositoryDel } =
  await import('../../../../src/commands/repository/cmd-repository-del.mts')

describe('cmd-repository-del', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdRepositoryDel.description).toBe(
        'Delete a repository in an organization',
      )
    })

    it('should not be hidden', () => {
      expect(cmdRepositoryDel.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-repository-del.mts' }
    const context = { parentName: 'socket repository' }

    it('should support --dry-run flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryDel.run(
        ['test-repo', '--dry-run'],
        importMeta,
        context,
      )

      expect(mockHandleDeleteRepo).not.toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Would delete repository'),
      )
    })

    it('should fail without Socket API token', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(false)

      await cmdRepositoryDel.run(
        ['test-repo', '--no-interactive'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleDeleteRepo).not.toHaveBeenCalled()
    })

    it('should fail without org slug', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['', ''])
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryDel.run(
        ['test-repo', '--no-interactive'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleDeleteRepo).not.toHaveBeenCalled()
    })

    it('should fail without repository name', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryDel.run(['--no-interactive'], importMeta, context)

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleDeleteRepo).not.toHaveBeenCalled()
    })

    it('should call handleDeleteRepo with correct parameters', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryDel.run(
        ['test-repo', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleDeleteRepo).toHaveBeenCalledWith(
        'test-org',
        'test-repo',
        'text',
      )
    })

    it('should pass --org flag to determineOrgSlug', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['custom-org', 'custom-org'])
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryDel.run(
        ['test-repo', '--org', 'custom-org', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith(
        'custom-org',
        false,
        false,
      )
      expect(mockHandleDeleteRepo).toHaveBeenCalledWith(
        'custom-org',
        'test-repo',
        'text',
      )
    })

    it('should pass --json flag to handleDeleteRepo', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryDel.run(
        ['test-repo', '--json', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleDeleteRepo).toHaveBeenCalledWith(
        'test-org',
        'test-repo',
        'json',
      )
    })

    it('should pass --markdown flag to handleDeleteRepo', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryDel.run(
        ['test-repo', '--markdown', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleDeleteRepo).toHaveBeenCalledWith(
        'test-org',
        'test-repo',
        'markdown',
      )
    })

    it('should fail when both --json and --markdown flags are set', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryDel.run(
        ['test-repo', '--json', '--markdown', '--no-interactive'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleDeleteRepo).not.toHaveBeenCalled()
    })

    it('should show repository identifier in dry-run mode', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryDel.run(['my-repo', '--dry-run'], importMeta, context)

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('test-org/my-repo'),
      )
    })

    it('should pass interactive flag to determineOrgSlug', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryDel.run(
        ['test-repo', '--interactive'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('', true, false)
    })

    it('should pass dry-run flag to determineOrgSlug', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryDel.run(
        ['test-repo', '--dry-run'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('', true, true)
    })

    it('should handle repository names with special characters', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryDel.run(
        ['my-special-repo-123', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleDeleteRepo).toHaveBeenCalledWith(
        'test-org',
        'my-special-repo-123',
        'text',
      )
    })

    it('should handle repository deletion with json output', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryDel.run(
        ['my-repo', '--json', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleDeleteRepo).toHaveBeenCalledWith(
        'test-org',
        'my-repo',
        'json',
      )
    })
  })
})
