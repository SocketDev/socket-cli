/**
 * Unit tests for repository create command.
 *
 * Tests the command that creates a new repository in an organization.
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
  const actual = await importOriginal<typeof import('@socketsecurity/lib/logger')>()
  return {
    ...actual,
    getDefaultLogger: () => mockLogger,
  }
})

// Mock dependencies.
const mockHandleCreateRepo = vi.hoisted(() => vi.fn())
const mockDetermineOrgSlug = vi.hoisted(() =>
  vi.fn().mockResolvedValue(['test-org', 'test-org']),
)
const mockHasDefaultApiToken = vi.hoisted(() => vi.fn().mockReturnValue(false))

vi.mock('../../../../src/commands/repository/handle-create-repo.mts', () => ({
  handleCreateRepo: mockHandleCreateRepo,
}))

vi.mock('../../../../src/utils/socket/org-slug.mjs', () => ({
  determineOrgSlug: mockDetermineOrgSlug,
}))

vi.mock('../../../../src/utils/socket/sdk.mjs', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../src/utils/socket/sdk.mjs')>()
  return {
    ...actual,
    hasDefaultApiToken: mockHasDefaultApiToken,
  }
})

// Import after mocks.
const { cmdRepositoryCreate } = await import(
  '../../../../src/commands/repository/cmd-repository-create.mts'
)

describe('cmd-repository-create', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdRepositoryCreate.description).toBe('Create a repository in an organization')
    })

    it('should not be hidden', () => {
      expect(cmdRepositoryCreate.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-repository-create.mts' }
    const context = { parentName: 'socket repository' }

    it('should support --dry-run flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryCreate.run(
        ['test-repo', '--dry-run'],
        importMeta,
        context,
      )

      expect(mockHandleCreateRepo).not.toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Would upload repository'),
      )
    })

    it('should fail without Socket API token', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(false)

      await cmdRepositoryCreate.run(
        ['test-repo', '--no-interactive'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleCreateRepo).not.toHaveBeenCalled()
    })

    it('should fail without org slug', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['', ''])
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryCreate.run(
        ['test-repo', '--no-interactive'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleCreateRepo).not.toHaveBeenCalled()
    })

    it('should fail without repository name', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryCreate.run(
        ['--no-interactive'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleCreateRepo).not.toHaveBeenCalled()
    })

    it('should call handleCreateRepo with default parameters', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryCreate.run(
        ['test-repo', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleCreateRepo).toHaveBeenCalledWith(
        {
          defaultBranch: 'main',
          description: '',
          homepage: '',
          orgSlug: 'test-org',
          repoName: 'test-repo',
          visibility: 'private',
        },
        'text',
      )
    })

    it('should pass --default-branch flag to handleCreateRepo', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryCreate.run(
        ['test-repo', '--default-branch', 'trunk', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleCreateRepo).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultBranch: 'trunk',
        }),
        'text',
      )
    })

    it('should pass --homepage flag to handleCreateRepo', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryCreate.run(
        ['test-repo', '--homepage', 'https://example.com', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleCreateRepo).toHaveBeenCalledWith(
        expect.objectContaining({
          homepage: 'https://example.com',
        }),
        'text',
      )
    })

    it('should pass --repo-description flag to handleCreateRepo', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryCreate.run(
        ['test-repo', '--repo-description', 'Test description', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleCreateRepo).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Test description',
        }),
        'text',
      )
    })

    it('should pass --visibility=public flag to handleCreateRepo', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryCreate.run(
        ['test-repo', '--visibility', 'public', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleCreateRepo).toHaveBeenCalledWith(
        expect.objectContaining({
          visibility: 'public',
        }),
        'text',
      )
    })

    it('should default to private visibility for invalid visibility values', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryCreate.run(
        ['test-repo', '--visibility', 'invalid', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleCreateRepo).toHaveBeenCalledWith(
        expect.objectContaining({
          visibility: 'private',
        }),
        'text',
      )
    })

    it('should pass --org flag to determineOrgSlug', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['custom-org', 'custom-org'])
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryCreate.run(
        ['test-repo', '--org', 'custom-org', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('custom-org', false, false)
      expect(mockHandleCreateRepo).toHaveBeenCalledWith(
        expect.objectContaining({
          orgSlug: 'custom-org',
        }),
        'text',
      )
    })

    it('should pass --json flag to handleCreateRepo', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryCreate.run(
        ['test-repo', '--json', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleCreateRepo).toHaveBeenCalledWith(
        expect.objectContaining({
          repoName: 'test-repo',
        }),
        'json',
      )
    })

    it('should pass --markdown flag to handleCreateRepo', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryCreate.run(
        ['test-repo', '--markdown', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleCreateRepo).toHaveBeenCalledWith(
        expect.objectContaining({
          repoName: 'test-repo',
        }),
        'markdown',
      )
    })

    it('should fail when both --json and --markdown flags are set', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryCreate.run(
        ['test-repo', '--json', '--markdown', '--no-interactive'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleCreateRepo).not.toHaveBeenCalled()
    })

    it('should show repository details in dry-run mode', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryCreate.run(
        ['my-repo', '--dry-run'],
        importMeta,
        context,
      )

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('organization: "test-org"'),
      )
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('repository: "my-repo"'),
      )
    })

    it('should pass interactive flag to determineOrgSlug', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryCreate.run(
        ['test-repo', '--interactive'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('', true, false)
    })

    it('should pass dry-run flag to determineOrgSlug', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryCreate.run(
        ['test-repo', '--dry-run'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('', true, true)
    })

    it('should handle all flags together', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryCreate.run(
        [
          'my-new-repo',
          '--default-branch', 'develop',
          '--homepage', 'https://socket.dev',
          '--repo-description', 'A test repository',
          '--visibility', 'public',
          '--no-interactive',
        ],
        importMeta,
        context,
      )

      expect(mockHandleCreateRepo).toHaveBeenCalledWith(
        {
          defaultBranch: 'develop',
          description: 'A test repository',
          homepage: 'https://socket.dev',
          orgSlug: 'test-org',
          repoName: 'my-new-repo',
          visibility: 'public',
        },
        'text',
      )
    })

    it('should handle empty string values for optional flags', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryCreate.run(
        [
          'test-repo',
          '--default-branch', '',
          '--homepage', '',
          '--repo-description', '',
          '--no-interactive',
        ],
        importMeta,
        context,
      )

      expect(mockHandleCreateRepo).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultBranch: '',
          description: '',
          homepage: '',
        }),
        'text',
      )
    })
  })
})
