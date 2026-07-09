/**
 * Unit tests for git operations.
 *
 * Purpose: Tests git operations (clone, status, diff, etc.). Validates git
 * command execution and output parsing.
 *
 * Test Coverage: - Git clone - Git status parsing - Git diff - Git log - Branch
 * detection - Commit information.
 *
 * Testing Approach: Uses mocked git subprocess calls to test git integrations.
 *
 * Related Files: - util/git/operations.mts (implementation)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetEnv, setEnv } from '@socketsecurity/lib-stable/env/rewire'

import {
  getBaseBranch,
  gitBranch,
  gitCommit,
  parseGitRemoteUrl,
} from '../../../../src/util/git/operations.mts'

// Mock spawn.
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/errors'), () => ({
  isSpawnError: vi.fn(e => e?.isSpawnError),
}))

// Mock whichReal().
vi.mock(import('@socketsecurity/lib-stable/bin/which'), () => ({
  whichReal: vi.fn().mockResolvedValue('git'),
}))

vi.mock(import('../../../../src/constants/cli.mts'), () => ({
  FLAG_QUIET: '--quiet',
}))

// Mock debug.
vi.mock(import('../../../../src/util/debug.mts'), () => ({
  debugGit: vi.fn(),
}))

describe('git utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    // Reset environment variable overrides after each test.
    resetEnv()
  })

  describe('parseGitRemoteUrl', () => {
    it('parses SSH URLs', () => {
      const result = parseGitRemoteUrl('git@github.com:owner/repo.git')
      expect(result).toEqual({ owner: 'owner', repo: 'repo' })
    })

    it('parses HTTPS URLs', () => {
      const result = parseGitRemoteUrl('https://github.com/owner/repo.git')
      expect(result).toEqual({ owner: 'owner', repo: 'repo' })
    })

    it('parses URLs without .git extension', () => {
      const result = parseGitRemoteUrl('https://github.com/owner/repo')
      expect(result).toEqual({ owner: 'owner', repo: 'repo' })
    })

    it('handles GitLab URLs', () => {
      const result = parseGitRemoteUrl('git@gitlab.com:owner/repo.git')
      expect(result).toEqual({ owner: 'owner', repo: 'repo' })
    })

    it('handles Bitbucket URLs', () => {
      const result = parseGitRemoteUrl('git@bitbucket.org:owner/repo.git')
      expect(result).toEqual({ owner: 'owner', repo: 'repo' })
    })

    it('returns undefined for invalid URLs', () => {
      expect(parseGitRemoteUrl('not-a-url')).toBeUndefined()
      expect(parseGitRemoteUrl('')).toBeUndefined()
      expect(parseGitRemoteUrl('http://example.com')).toBeUndefined()
    })

    it('handles URLs with ports', () => {
      const result = parseGitRemoteUrl('ssh://git@github.com:22/owner/repo.git')
      expect(result).toEqual({ owner: 'owner', repo: 'repo' })
    })
  })

  describe('getBaseBranch', () => {
    it('returns GITHUB_BASE_REF when in PR', async () => {
      setEnv('GITHUB_BASE_REF', 'main')

      const result = await getBaseBranch()
      expect(result).toBe('main')
    })

    it('returns GITHUB_REF_NAME when it is a branch', async () => {
      setEnv('GITHUB_BASE_REF', '')
      setEnv('GITHUB_REF_TYPE', 'branch')
      setEnv('GITHUB_REF_NAME', 'feature-branch')

      const result = await getBaseBranch()
      expect(result).toBe('feature-branch')
    })

    it('calls detectDefaultBranch when no GitHub env vars', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      spawn.mockResolvedValue({
        status: 0,
        stdout: 'main\n',
        stderr: '',
      } as unknown)

      const result = await getBaseBranch('/test/dir')
      expect(result).toBe('main')
    })

    it('returns "main" fallback when git remote show returns falsy (line 100)', async () => {
      setEnv('GITHUB_BASE_REF', '')
      setEnv('GITHUB_REF_TYPE', '')
      setEnv('GITHUB_REF_NAME', '')
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      spawn.mockResolvedValueOnce(undefined as unknown)

      const result = await getBaseBranch('/test/dir')
      expect(result).toBe('main')
    })

    it('parses HEAD branch from git remote show origin output (line 110)', async () => {
      setEnv('GITHUB_BASE_REF', '')
      setEnv('GITHUB_REF_TYPE', '')
      setEnv('GITHUB_REF_NAME', '')
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      spawn.mockResolvedValueOnce({
        status: 0,
        stdout:
          '* remote origin\n  Fetch URL: git@github.com:o/r.git\n  HEAD branch: develop\n  Remote branches:\n',
        stderr: '',
      } as unknown)

      const result = await getBaseBranch('/test/dir')
      expect(result).toBe('develop')
    })
  })

  describe('gitBranch', () => {
    it('returns current branch name', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      spawn.mockResolvedValue({
        status: 0,
        stdout: 'feature-branch\n',
        stderr: '',
      } as unknown)

      const result = await gitBranch()
      expect(result).toBe('feature-branch\n')
      expect(spawn).toHaveBeenCalledWith(
        'git',
        ['symbolic-ref', '--short', 'HEAD'],
        expect.any(Object),
      )
    })

    it('handles detached HEAD state', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      spawn
        .mockRejectedValueOnce(new Error('Not on a branch'))
        .mockResolvedValueOnce({
          status: 0,
          stdout: 'abc1234\n',
          stderr: '',
        } as unknown)

      const result = await gitBranch()
      expect(result).toBe('abc1234\n')
    })

    it('handles spawn errors', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      const { isSpawnError } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/errors'),
      )
      const error = { isSpawnError: true, message: 'Command failed' }
      spawn.mockRejectedValue(error)
      isSpawnError.mockReturnValue(true)

      const result = await gitBranch()
      expect(result).toBeUndefined()
    })
  })

  describe('gitCommit', () => {
    it('creates a commit with message and files', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      spawn.mockResolvedValue({ status: 0, stdout: '', stderr: '' } as unknown)

      const result = await gitCommit(
        'Test commit',
        ['file1.txt', 'file2.txt'],
        {
          cwd: '/test/dir',
        },
      )
      expect(result).toBe(true)
      expect(spawn).toHaveBeenCalledWith(
        'git',
        ['add', 'file1.txt', 'file2.txt'],
        expect.any(Object),
      )
      expect(spawn).toHaveBeenCalledWith(
        'git',
        ['commit', '-m', 'Test commit'],
        expect.any(Object),
      )
    })

    it('handles commit without files', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      spawn.mockResolvedValue({ status: 0, stdout: '', stderr: '' } as unknown)

      const result = await gitCommit('Test commit', [], { cwd: '/test/dir' })
      expect(result).toBe(false)
      expect(spawn).not.toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['add']),
        expect.any(Object),
      )
    })

    it('returns false when git add rejects (lines 344-347)', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      // gitEnsureIdentity calls spawn first - allow those to succeed.
      // Then the git add call should fail.
      spawn.mockImplementation((_cmd: unknown, args: unknown) => {
        if (args?.includes('add')) {
          return Promise.reject(new Error('add failed')) as unknown
        }
        return Promise.resolve({ status: 0, stdout: '', stderr: '' }) as unknown
      })

      const result = await gitCommit('Test commit', ['file.txt'], {
        cwd: '/test/dir',
      })
      expect(result).toBe(false)
    })

    it('returns false when git commit rejects (lines 355-358)', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      // Allow add to succeed, fail on commit.
      spawn.mockImplementation((_cmd: unknown, args: unknown) => {
        if (args?.[0] === 'commit') {
          return Promise.reject(new Error('commit failed')) as unknown
        }
        return Promise.resolve({ status: 0, stdout: '', stderr: '' }) as unknown
      })

      const result = await gitCommit('Test commit', ['file.txt'], {
        cwd: '/test/dir',
      })
      expect(result).toBe(false)
    })
  })
})
