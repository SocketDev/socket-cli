/**
 * Unit tests for repository update command.
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

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdRepositoryUpdate.description).toBe(
        'Update a repository in an organization',
      )
    })

    it('should not be hidden', () => {
      expect(cmdRepositoryUpdate.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-repository-update.mts' }
    const context = { parentName: 'socket repository' }

    it('should support --dry-run flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryUpdate.run(
        ['test-repo', '--dry-run'],
        importMeta,
        context,
      )

      expect(mockHandleUpdateRepo).not.toHaveBeenCalled()
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Would upload repository (update)'),
      )
    })

    it('should fail without Socket API token', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(false)

      await cmdRepositoryUpdate.run(
        ['test-repo', '--no-interactive'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleUpdateRepo).not.toHaveBeenCalled()
    })

    it('should fail without org slug', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['', ''])
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryUpdate.run(
        ['test-repo', '--no-interactive'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleUpdateRepo).not.toHaveBeenCalled()
    })

    it('should fail without repository name', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryUpdate.run(['--no-interactive'], importMeta, context)

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleUpdateRepo).not.toHaveBeenCalled()
    })

    it('should call handleUpdateRepo with default parameters', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryUpdate.run(
        ['test-repo', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleUpdateRepo).toHaveBeenCalledWith(
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

    it('should pass --default-branch flag to handleUpdateRepo', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryUpdate.run(
        ['test-repo', '--default-branch', 'develop', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleUpdateRepo).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultBranch: 'develop',
        }),
        'text',
      )
    })

    it('should pass -b short flag to handleUpdateRepo', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryUpdate.run(
        ['test-repo', '-b', 'develop', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleUpdateRepo).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultBranch: 'develop',
        }),
        'text',
      )
    })

    it('should pass --homepage flag to handleUpdateRepo', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryUpdate.run(
        ['test-repo', '--homepage', 'https://example.com', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleUpdateRepo).toHaveBeenCalledWith(
        expect.objectContaining({
          homepage: 'https://example.com',
        }),
        'text',
      )
    })

    it('should pass -h short flag to handleUpdateRepo', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryUpdate.run(
        ['test-repo', '-h', 'https://example.com', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleUpdateRepo).toHaveBeenCalledWith(
        expect.objectContaining({
          homepage: 'https://example.com',
        }),
        'text',
      )
    })

    it('should pass --repo-description flag to handleUpdateRepo', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryUpdate.run(
        [
          'test-repo',
          '--repo-description',
          'Updated description',
          '--no-interactive',
        ],
        importMeta,
        context,
      )

      expect(mockHandleUpdateRepo).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Updated description',
        }),
        'text',
      )
    })

    it('should pass -d short flag to handleUpdateRepo', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryUpdate.run(
        ['test-repo', '-d', 'Updated description', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleUpdateRepo).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Updated description',
        }),
        'text',
      )
    })

    it('should pass --visibility flag to handleUpdateRepo', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryUpdate.run(
        ['test-repo', '--visibility', 'public', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleUpdateRepo).toHaveBeenCalledWith(
        expect.objectContaining({
          visibility: 'public',
        }),
        'text',
      )
    })

    it('should pass -v short flag to handleUpdateRepo', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryUpdate.run(
        ['test-repo', '-v', 'public', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleUpdateRepo).toHaveBeenCalledWith(
        expect.objectContaining({
          visibility: 'public',
        }),
        'text',
      )
    })

    it('should preserve visibility value as-is (not force private)', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryUpdate.run(
        ['test-repo', '--visibility', 'invalid', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleUpdateRepo).toHaveBeenCalledWith(
        expect.objectContaining({
          visibility: 'invalid',
        }),
        'text',
      )
    })

    it('should pass --org flag to determineOrgSlug', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['custom-org', 'custom-org'])
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdRepositoryUpdate.run(
        ['test-repo', '--org', 'custom-org', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith(
        'custom-org',
        false,
        false,
      )
      expect(mockHandleUpdateRepo).toHaveBeenCalledWith(
        expect.objectContaining({
          orgSlug: 'custom-org',
        }),
        'text',
      )
    })
  })
})
