/* max-file-lines: legitimate — comprehensive test suite for one command/module; splitting would fragment closely related assertions. */
/**
 * Unit tests for git operations.
 *
 * Purpose:
 * Tests git operations (clone, status, diff, etc.). Validates git command execution and output parsing.
 *
 * Test Coverage:
 * - Git clone
 * - Git status parsing
 * - Git diff
 * - Git log
 * - Branch detection
 * - Commit information
 *
 * Testing Approach:
 * Uses mocked git subprocess calls to test git integrations.
 *
 * Related Files:
 * - util/git/operations.mts (implementation)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetEnv, setEnv } from '@socketsecurity/lib/env/rewire'

import {
  detectDefaultBranch,
  getBaseBranch,
  getRepoInfo,
  getRepoName,
  getRepoOwner,
  gitBranch,
  gitCheckoutBranch,
  gitCleanFdx,
  gitCommit,
  gitCreateBranch,
  gitDeleteBranch,
  gitDeleteRemoteBranch,
  gitEnsureIdentity,
  gitLocalBranchExists,
  gitPushBranch,
  gitRemoteBranchExists,
  gitResetAndClean,
  gitResetHard,
  gitUnstagedModifiedFiles,
  parseGitRemoteUrl,
} from '../../../../src/util/git/operations.mts'

// Mock spawn.
vi.mock('@socketsecurity/lib/spawn', () => ({
  spawn: vi.fn(),
  isSpawnError: vi.fn(e => e?.isSpawnError),
}))

// Mock whichReal().
vi.mock('@socketsecurity/lib/bin', () => ({
  whichReal: vi.fn().mockResolvedValue('git'),
}))

vi.mock('../../../../src/constants/cli.mts', () => ({
  FLAG_QUIET: '--quiet',
}))

// Mock debug.
vi.mock('../../../../src/util/debug.mts', () => ({
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
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
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
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn.mockResolvedValueOnce(undefined as unknown)

      const result = await getBaseBranch('/test/dir')
      expect(result).toBe('main')
    })

    it('parses HEAD branch from git remote show origin output (line 110)', async () => {
      setEnv('GITHUB_BASE_REF', '')
      setEnv('GITHUB_REF_TYPE', '')
      setEnv('GITHUB_REF_NAME', '')
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
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
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
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
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
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
      const { isSpawnError, spawn } = vi.mocked(
        await import('@socketsecurity/lib/spawn'),
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
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn.mockResolvedValue({ status: 0, stdout: '', stderr: '' } as unknown)

      const result = await gitCommit(
        'Test commit',
        ['file1.txt', 'file2.txt'],
        { cwd: '/test/dir' },
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
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
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
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
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
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
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

  describe('gitCheckoutBranch', () => {
    it('checks out a branch', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn.mockResolvedValue({ status: 0, stdout: '', stderr: '' } as unknown)

      const result = await gitCheckoutBranch('main')
      expect(result).toBe(true)
      expect(spawn).toHaveBeenCalledWith(
        'git',
        ['checkout', 'main'],
        expect.any(Object),
      )
    })

    it('returns false when checkout spawn rejects (lines 261-264)', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn.mockRejectedValue(new Error('checkout failed'))

      const result = await gitCheckoutBranch('nonexistent')
      expect(result).toBe(false)
    })
  })

  describe('gitCreateBranch', () => {
    it('creates a new branch', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn
        .mockRejectedValueOnce(new Error('Branch does not exist')) // gitLocalBranchExists fails.
        .mockResolvedValueOnce({ status: 0, stdout: '', stderr: '' } as unknown) // git branch succeeds.

      const result = await gitCreateBranch('new-feature')
      expect(result).toBe(true)
      expect(spawn).toHaveBeenCalledWith(
        'git',
        ['show-ref', '--quiet', 'refs/heads/new-feature'],
        expect.any(Object),
      )
      expect(spawn).toHaveBeenCalledWith(
        'git',
        ['branch', 'new-feature'],
        expect.any(Object),
      )
    })

    it('returns true early when branch already exists (line 272)', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      // gitLocalBranchExists resolves successfully (branch exists).
      spawn.mockResolvedValue({ status: 0, stdout: '', stderr: '' } as unknown)

      const result = await gitCreateBranch('existing-branch')
      expect(result).toBe(true)
      // Only the show-ref call should occur — no `git branch` create.
      expect(spawn).not.toHaveBeenCalledWith(
        'git',
        ['branch', 'existing-branch'],
        expect.any(Object),
      )
    })

    it('returns false when branch creation rejects (lines 282-286)', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn
        .mockRejectedValueOnce(new Error('Branch does not exist')) // gitLocalBranchExists fails.
        .mockRejectedValueOnce(new Error('branch creation failed')) // git branch fails.

      const result = await gitCreateBranch('bad-branch')
      expect(result).toBe(false)
    })
  })

  describe('gitDeleteBranch', () => {
    it('deletes a local branch', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn.mockResolvedValue({ status: 0, stdout: '', stderr: '' } as unknown)

      const result = await gitDeleteBranch('old-feature')
      expect(result).toBe(true)
      expect(spawn).toHaveBeenCalledWith(
        'git',
        ['branch', '-D', 'old-feature'],
        expect.any(Object),
      )
    })

    it('returns false when delete rejects (lines 377-382)', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn.mockRejectedValue(new Error('branch does not exist'))

      const result = await gitDeleteBranch('nonexistent')
      expect(result).toBe(false)
    })
  })

  describe('gitPushBranch', () => {
    it('pushes a branch to remote', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn.mockResolvedValue({ status: 0, stdout: '', stderr: '' } as unknown)

      const result = await gitPushBranch('feature')
      expect(result).toBe(true)
      expect(spawn).toHaveBeenCalledWith(
        'git',
        ['push', '--force', '--set-upstream', 'origin', 'feature'],
        expect.any(Object),
      )
    })

    it('returns false on generic spawn rejection (lines 312-313)', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn.mockRejectedValue(new Error('network error'))

      const result = await gitPushBranch('feature')
      expect(result).toBe(false)
    })

    it('returns false on 128 spawn-error (token permissions, lines 305-311)', async () => {
      const { spawn, isSpawnError } = vi.mocked(
        await import('@socketsecurity/lib/spawn'),
      )
      const err: unknown = new Error('token denied')
      err.isSpawnError = true
      err.code = 128
      isSpawnError.mockReturnValueOnce(true)
      spawn.mockRejectedValue(err)

      const result = await gitPushBranch('feature')
      expect(result).toBe(false)
    })
  })

  describe('gitCleanFdx', () => {
    it('cleans untracked files', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn.mockResolvedValue({ status: 0, stdout: '', stderr: '' } as unknown)

      const result = await gitCleanFdx()
      expect(result).toBe(true)
      expect(spawn).toHaveBeenCalledWith(
        'git',
        ['clean', '-fdx'],
        expect.any(Object),
      )
    })

    it('returns false when clean spawn rejects (lines 242-245)', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn.mockRejectedValue(new Error('clean failed'))

      const result = await gitCleanFdx()
      expect(result).toBe(false)
    })
  })

  describe('gitResetHard', () => {
    it('resets to a specific ref', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn.mockResolvedValue({ status: 0, stdout: '', stderr: '' } as unknown)

      const result = await gitResetHard('origin/main')
      expect(result).toBe(true)
      expect(spawn).toHaveBeenCalledWith(
        'git',
        ['reset', '--hard', 'origin/main'],
        expect.any(Object),
      )
    })

    it('returns false when reset spawn rejects (lines 525-527)', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn.mockRejectedValue(new Error('reset failed'))

      const result = await gitResetHard('origin/main')
      expect(result).toBe(false)
    })
  })

  describe('gitEnsureIdentity', () => {
    it('sets git user name and email', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn.mockResolvedValue({ status: 0, stdout: '', stderr: '' } as unknown)

      await gitEnsureIdentity('Test User', 'test@example.com')
      expect(spawn).toHaveBeenCalledWith(
        'git',
        ['config', '--get', 'user.email'],
        expect.any(Object),
      )
      expect(spawn).toHaveBeenCalledWith(
        'git',
        ['config', '--get', 'user.name'],
        expect.any(Object),
      )
    })

    it('handles config set when get fails and value differs (lines 432-450)', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      // Reject `git config --get` so configValue stays undefined != desired value;
      // then `git config <prop> <value>` resolves successfully.
      spawn.mockImplementation((_cmd: unknown, args: unknown) => {
        if (args?.[1] === '--get') {
          return Promise.reject(new Error('not set')) as unknown
        }
        return Promise.resolve({ status: 0, stdout: '', stderr: '' }) as unknown
      })

      await gitEnsureIdentity('Test User', 'test@example.com')
      // Verify the set calls happened.
      expect(spawn).toHaveBeenCalledWith(
        'git',
        ['config', 'user.email', 'test@example.com'],
        expect.any(Object),
      )
      expect(spawn).toHaveBeenCalledWith(
        'git',
        ['config', 'user.name', 'Test User'],
        expect.any(Object),
      )
    })

    it('logs failure when config set rejects (lines 447-450)', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      // Reject get; reject set.
      spawn.mockImplementation((_cmd: unknown, args: unknown) => {
        if (args?.[1] === '--get') {
          return Promise.reject(new Error('not set')) as unknown
        }
        return Promise.reject(new Error('config set failed')) as unknown
      })

      // No throw expected; promises are awaited via Promise.allSettled.
      await expect(
        gitEnsureIdentity('Test User', 'test@example.com'),
      ).resolves.toBeUndefined()
    })
  })

  describe('getRepoInfo', () => {
    it('returns owner and repo from remote URL', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn.mockResolvedValue({
        status: 0,
        stdout: 'git@github.com:socketdev/socket-cli.git',
        stderr: '',
      } as unknown)

      const result = await getRepoInfo('/test/dir')
      expect(result).toEqual({ owner: 'socketdev', repo: 'socket-cli' })
    })

    it('returns undefined when spawn fails', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn.mockRejectedValue(new Error('Not a git repo'))

      const result = await getRepoInfo('/test/dir')
      expect(result).toBeUndefined()
    })

    it('returns undefined when spawn returns null', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn.mockResolvedValue(undefined as unknown)

      const result = await getRepoInfo('/test/dir')
      expect(result).toBeUndefined()
    })

    it('returns undefined for unmatched git remote URL format (lines 142-145)', async () => {
      // Some private SSH config (e.g. host alias `myhost:owner/repo`) doesn't
      // match the parser's regex; the function falls through and the debug
      // logs fire.
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn.mockResolvedValue({
        status: 0,
        stdout: 'some-completely-unrecognised-url-format',
        stderr: '',
      } as unknown)

      const result = await getRepoInfo('/test/dir')
      expect(result).toBeUndefined()
    })
  })

  describe('getRepoName', () => {
    it('returns repo name from remote URL', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn.mockResolvedValue({
        status: 0,
        stdout: 'git@github.com:socketdev/socket-cli.git',
        stderr: '',
      } as unknown)

      const result = await getRepoName('/test/dir')
      expect(result).toBe('socket-cli')
    })

    it('returns default when no repo info', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn.mockRejectedValue(new Error('Not a git repo'))

      const result = await getRepoName('/test/dir')
      // Should return the default repository name.
      expect(typeof result).toBe('string')
    })
  })

  describe('getRepoOwner', () => {
    it('returns owner from remote URL', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn.mockResolvedValue({
        status: 0,
        stdout: 'git@github.com:socketdev/socket-cli.git',
        stderr: '',
      } as unknown)

      const result = await getRepoOwner('/test/dir')
      expect(result).toBe('socketdev')
    })

    it('returns undefined when no repo info', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn.mockRejectedValue(new Error('Not a git repo'))

      const result = await getRepoOwner('/test/dir')
      expect(result).toBeUndefined()
    })
  })

  describe('detectDefaultBranch', () => {
    it('returns main when it exists locally', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn.mockResolvedValue({ status: 0, stdout: '', stderr: '' } as unknown)

      const result = await detectDefaultBranch('/test/dir')
      expect(result).toBe('main')
    })

    it('checks common branch names in order', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      // All local branches fail.
      spawn
        .mockRejectedValueOnce(new Error('main not found'))
        .mockRejectedValueOnce(new Error('master not found')) // inclusive-language: external-api
        .mockRejectedValueOnce(new Error('develop not found'))
        .mockRejectedValueOnce(new Error('trunk not found'))
        .mockRejectedValueOnce(new Error('default not found'))
        // First remote succeeds.
        .mockResolvedValueOnce({
          status: 0,
          stdout: 'refs/heads/main',
          stderr: '',
        } as unknown)

      const result = await detectDefaultBranch('/test/dir')
      expect(result).toBe('main')
    })

    it('falls back to SOCKET_DEFAULT_BRANCH when nothing matches (line 223)', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      // All local AND remote checks reject — exhaust both passes.
      spawn.mockRejectedValue(new Error('not found'))

      const result = await detectDefaultBranch('/test/dir')
      expect(result).toBe('socket-default-branch')
    })
  })

  describe('gitDeleteRemoteBranch', () => {
    it('deletes a remote branch', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn.mockResolvedValue({ status: 0, stdout: '', stderr: '' } as unknown)

      const result = await gitDeleteRemoteBranch('old-feature')
      expect(result).toBe(true)
      expect(spawn).toHaveBeenCalledWith(
        'git',
        ['push', 'origin', '--delete', 'old-feature'],
        expect.any(Object),
      )
    })

    it('returns false when branch does not exist', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn.mockRejectedValue(new Error('Branch not found'))

      const result = await gitDeleteRemoteBranch('nonexistent')
      expect(result).toBe(false)
    })
  })

  describe('gitLocalBranchExists', () => {
    it('returns true when branch exists', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn.mockResolvedValue({ status: 0, stdout: '', stderr: '' } as unknown)

      const result = await gitLocalBranchExists('main')
      expect(result).toBe(true)
      expect(spawn).toHaveBeenCalledWith(
        'git',
        ['show-ref', '--quiet', 'refs/heads/main'],
        expect.any(Object),
      )
    })

    it('returns false when branch does not exist', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn.mockRejectedValue(new Error('Branch not found'))

      const result = await gitLocalBranchExists('nonexistent')
      expect(result).toBe(false)
    })
  })

  describe('gitRemoteBranchExists', () => {
    it('returns true when remote branch exists', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn.mockResolvedValue({
        status: 0,
        stdout: 'abc123\trefs/heads/main',
        stderr: '',
      } as unknown)

      const result = await gitRemoteBranchExists('main')
      expect(result).toBe(true)
      expect(spawn).toHaveBeenCalledWith(
        'git',
        ['ls-remote', '--heads', 'origin', 'main'],
        expect.any(Object),
      )
    })

    it('returns false when remote branch does not exist', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn.mockResolvedValue({
        status: 0,
        stdout: '',
        stderr: '',
      } as unknown)

      const result = await gitRemoteBranchExists('nonexistent')
      expect(result).toBe(false)
    })

    it('returns false when spawn fails', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn.mockRejectedValue(new Error('Network error'))

      const result = await gitRemoteBranchExists('main')
      expect(result).toBe(false)
    })
  })

  describe('gitResetAndClean', () => {
    it('calls gitResetHard and gitCleanFdx', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn.mockResolvedValue({ status: 0, stdout: '', stderr: '' } as unknown)

      await gitResetAndClean('main', '/test/dir')
      expect(spawn).toHaveBeenCalledWith(
        'git',
        ['reset', '--hard', 'main'],
        expect.any(Object),
      )
      expect(spawn).toHaveBeenCalledWith(
        'git',
        ['clean', '-fdx'],
        expect.any(Object),
      )
    })
  })

  describe('gitUnstagedModifiedFiles', () => {
    it('returns list of modified files', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn.mockResolvedValue({
        status: 0,
        stdout: 'file1.txt\nfile2.txt\n',
        stderr: '',
      } as unknown)

      const result = await gitUnstagedModifiedFiles('/test/dir')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toContain('file1.txt')
        expect(result.data).toContain('file2.txt')
      }
    })

    it('returns error when spawn fails', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
      spawn.mockRejectedValue(new Error('Git error'))

      const result = await gitUnstagedModifiedFiles('/test/dir')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('Git Error')
      }
    })
  })

  describe('getGitPath', () => {
    it('throws a helpful error when whichReal returns null (line 58)', async () => {
      // Reset modules so the module-level _gitPath cache is fresh and
      // whichReal can be mocked to return null without other tests
      // having already filled the cache.
      vi.resetModules()
      vi.doMock('@socketsecurity/lib/bin', () => ({
        whichReal: vi.fn().mockResolvedValue(undefined),
      }))
      const { getGitPath: freshGetGitPath } =
        await import('../../../../src/util/git/operations.mts')
      await expect(freshGetGitPath()).rejects.toThrow(/whichReal returned null/)
      vi.doUnmock('@socketsecurity/lib/bin')
      vi.resetModules()
    })

    it('throws when whichReal returns multiple matches', async () => {
      vi.resetModules()
      vi.doMock('@socketsecurity/lib/bin', () => ({
        whichReal: vi.fn().mockResolvedValue(['/usr/bin/git', '/opt/bin/git']),
      }))
      const { getGitPath: freshGetGitPath } =
        await import('../../../../src/util/git/operations.mts')
      await expect(freshGetGitPath()).rejects.toThrow(/multiple matches/)
      vi.doUnmock('@socketsecurity/lib/bin')
      vi.resetModules()
    })
  })
})
