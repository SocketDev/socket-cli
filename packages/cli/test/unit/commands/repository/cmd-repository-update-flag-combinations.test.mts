/**
 * Unit tests for repository update command output-format and combined-flag
 * scenarios.
 *
 * Tests the command that updates a repository in an organization.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cmdRepositoryUpdate } from '../../../../src/commands/repository/cmd-repository-update.mts'

import type * as LoggerModule from '@socketsecurity/lib-stable/logger/default'
import type * as SdkModule from '../../../../src/util/socket/sdk.mjs'

// Mock the logger.
const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

vi.mock(
  import('@socketsecurity/lib-stable/logger/default'),
  async importOriginal => {
    const actual = await importOriginal<typeof LoggerModule>()
    return {
      ...actual,
      getDefaultLogger: () => mockLogger,
    }
  },
)

// Mock dependencies.
const mockHandleUpdateRepo = vi.hoisted(() => vi.fn())
const mockDetermineOrgSlug = vi.hoisted(() =>
  vi.fn().mockResolvedValue(['test-org', 'test-org']),
)
const mockHasDefaultApiToken = vi.hoisted(() => vi.fn().mockReturnValue(false))

vi.mock(
  import('../../../../src/commands/repository/handle-update-repo.mts'),
  () => ({
    handleUpdateRepo: mockHandleUpdateRepo,
  }),
)

vi.mock(import('../../../../src/util/socket/org-slug.mjs'), () => ({
  determineOrgSlug: mockDetermineOrgSlug,
}))

vi.mock(import('../../../../src/util/socket/sdk.mjs'), async importOriginal => {
  const actual = await importOriginal<typeof SdkModule>()
  return {
    ...actual,
    hasDefaultApiToken: mockHasDefaultApiToken,
  }
})

describe('cmd-repository-update', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-repository-update.mts' }
    const context = { parentName: 'socket repository' }

    it('should pass --json flag to handleUpdateRepo', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryUpdate.run(
        ['test-repo', '--json', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleUpdateRepo).toHaveBeenCalledWith(
        expect.objectContaining({
          repoName: 'test-repo',
        }),
        'json',
      )
    })

    it('should pass --markdown flag to handleUpdateRepo', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryUpdate.run(
        ['test-repo', '--markdown', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleUpdateRepo).toHaveBeenCalledWith(
        expect.objectContaining({
          repoName: 'test-repo',
        }),
        'markdown',
      )
    })

    it('should fail when both --json and --markdown flags are set', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryUpdate.run(
        ['test-repo', '--json', '--markdown', '--no-interactive'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleUpdateRepo).not.toHaveBeenCalled()
    })

    it('should show repository details in dry-run mode', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryUpdate.run(
        ['my-repo', '--dry-run'],
        importMeta,
        context,
      )

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('organization: "test-org"'),
      )
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('repository: "my-repo"'),
      )
    })

    it('should pass interactive flag to determineOrgSlug', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryUpdate.run(
        ['test-repo', '--interactive'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('', true, false)
    })

    it('should pass dry-run flag to determineOrgSlug', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryUpdate.run(
        ['test-repo', '--dry-run'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('', true, true)
    })

    it('should handle all flags together', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryUpdate.run(
        [
          'my-repo',
          '--default-branch',
          'main',
          '--homepage',
          'https://socket.dev',
          '--repo-description',
          'Updated repository',
          '--visibility',
          'public',
          '--no-interactive',
        ],
        importMeta,
        context,
      )

      expect(mockHandleUpdateRepo).toHaveBeenCalledWith(
        {
          defaultBranch: 'main',
          description: 'Updated repository',
          homepage: 'https://socket.dev',
          orgSlug: 'test-org',
          repoName: 'my-repo',
          visibility: 'public',
        },
        'text',
      )
    })

    it('should handle all short flags together', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryUpdate.run(
        [
          'my-repo',
          '-b',
          'develop',
          '-h',
          'https://example.com',
          '-d',
          'Test description',
          '-v',
          'private',
          '--no-interactive',
        ],
        importMeta,
        context,
      )

      expect(mockHandleUpdateRepo).toHaveBeenCalledWith(
        {
          defaultBranch: 'develop',
          description: 'Test description',
          homepage: 'https://example.com',
          orgSlug: 'test-org',
          repoName: 'my-repo',
          visibility: 'private',
        },
        'text',
      )
    })

    it('should handle empty string values for optional flags', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryUpdate.run(
        [
          'test-repo',
          '--default-branch',
          '',
          '--homepage',
          '',
          '--repo-description',
          '',
          '--visibility',
          '',
          '--no-interactive',
        ],
        importMeta,
        context,
      )

      expect(mockHandleUpdateRepo).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultBranch: '',
          description: '',
          homepage: '',
          visibility: 'private',
        }),
        'text',
      )
    })

    it('should handle repository names with special characters', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryUpdate.run(
        ['my-special-repo-123', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleUpdateRepo).toHaveBeenCalledWith(
        expect.objectContaining({
          repoName: 'my-special-repo-123',
        }),
        'text',
      )
    })

    describe('--default-branch empty-value detection', () => {
      it('fails when --default-branch= is passed with no value', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)

        await cmdRepositoryUpdate.run(
          ['test-repo', '--default-branch=', '--no-interactive'],
          importMeta,
          context,
        )

        expect(process.exitCode).toBe(2)
        expect(mockHandleUpdateRepo).not.toHaveBeenCalled()
        expect(mockLogger.fail).toHaveBeenCalledWith(
          expect.stringContaining('--default-branch requires a value'),
        )
      })

      it('fails on bare --default-branch followed by another flag', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)

        await cmdRepositoryUpdate.run(
          ['test-repo', '--default-branch', '--no-interactive'],
          importMeta,
          context,
        )

        expect(process.exitCode).toBe(2)
        expect(mockHandleUpdateRepo).not.toHaveBeenCalled()
      })
    })
  })
})
