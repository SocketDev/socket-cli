/**
 * Unit tests for repository view command.
 *
 * Tests the command that views a specific repository in an organization.
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
const mockHandleViewRepo = vi.hoisted(() => vi.fn())
const mockDetermineOrgSlug = vi.hoisted(() =>
  vi.fn().mockResolvedValue(['test-org', 'test-org']),
)
const mockHasDefaultApiToken = vi.hoisted(() => vi.fn().mockReturnValue(false))

vi.mock('../../../../src/commands/repository/handle-view-repo.mts', () => ({
  handleViewRepo: mockHandleViewRepo,
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
const { cmdRepositoryView } =
  await import('../../../../src/commands/repository/cmd-repository-view.mts')

describe('cmd-repository-view', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdRepositoryView.description).toBe(
        'View repositories in an organization',
      )
    })

    it('should not be hidden', () => {
      expect(cmdRepositoryView.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-repository-view.mts' }
    const context = { parentName: 'socket repository' }

    it('should support --dry-run flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryView.run(
        ['test-repo', '--dry-run'],
        importMeta,
        context,
      )

      expect(mockHandleViewRepo).not.toHaveBeenCalled()
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should fail without Socket API token', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(false)

      await cmdRepositoryView.run(
        ['test-repo', '--no-interactive'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleViewRepo).not.toHaveBeenCalled()
    })

    it('should fail without org slug', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['', ''])
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryView.run(
        ['test-repo', '--no-interactive'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleViewRepo).not.toHaveBeenCalled()
    })

    it('should fail without repository name', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryView.run(['--no-interactive'], importMeta, context)

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleViewRepo).not.toHaveBeenCalled()
    })

    it('should call handleViewRepo with correct parameters', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryView.run(
        ['test-repo', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleViewRepo).toHaveBeenCalledWith(
        'test-org',
        'test-repo',
        'text',
      )
    })

    it('should pass --org flag to determineOrgSlug', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['custom-org', 'custom-org'])
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryView.run(
        ['test-repo', '--org', 'custom-org', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith(
        'custom-org',
        false,
        false,
      )
      expect(mockHandleViewRepo).toHaveBeenCalledWith(
        'custom-org',
        'test-repo',
        'text',
      )
    })

    it('should pass --json flag to handleViewRepo', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryView.run(
        ['test-repo', '--json', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleViewRepo).toHaveBeenCalledWith(
        'test-org',
        'test-repo',
        'json',
      )
    })

    it('should pass --markdown flag to handleViewRepo', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryView.run(
        ['test-repo', '--markdown', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleViewRepo).toHaveBeenCalledWith(
        'test-org',
        'test-repo',
        'markdown',
      )
    })

    it('should fail when both --json and --markdown flags are set', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryView.run(
        ['test-repo', '--json', '--markdown', '--no-interactive'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleViewRepo).not.toHaveBeenCalled()
    })

    it('should show repository identifier in dry-run mode', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryView.run(['my-repo', '--dry-run'], importMeta, context)

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('test-org/my-repo'),
      )
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('organization: test-org'),
      )
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('repository: my-repo'),
      )
    })

    it('should pass interactive flag to determineOrgSlug', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryView.run(
        ['test-repo', '--interactive'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('', true, false)
    })

    it('should pass dry-run flag to determineOrgSlug', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryView.run(
        ['test-repo', '--dry-run'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('', true, true)
    })

    it('should handle repository names with special characters', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryView.run(
        ['my-special-repo-123', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleViewRepo).toHaveBeenCalledWith(
        'test-org',
        'my-special-repo-123',
        'text',
      )
    })
  })
})
