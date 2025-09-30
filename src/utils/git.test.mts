import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  detectDefaultBranch,
  getBaseBranch,
  getRepoInfo,
  gitBranch,
  gitCheckoutBranch,
  gitCleanFdx,
  gitCommit,
  gitCreateBranch,
  gitDeleteBranch,
  gitEnsureIdentity,
  gitPushBranch,
  gitResetHard,
  parseGitRemoteUrl,
} from './git.mts'

// Mock spawn.
vi.mock('@socketsecurity/registry/lib/spawn', () => ({
  spawn: vi.fn(),
  isSpawnError: vi.fn(e => e && e.isSpawnError),
}))

// Mock constants.
vi.mock('../constants.mts', () => ({
  default: {
    ENV: {
      GITHUB_BASE_REF: undefined,
      GITHUB_REF_NAME: undefined,
      GITHUB_REF_TYPE: undefined,
      SOCKET_CLI_GIT_USER_EMAIL: undefined,
      SOCKET_CLI_GIT_USER_NAME: undefined,
    },
    SOCKET_DEFAULT_BRANCH: 'main',
    SOCKET_DEFAULT_REPOSITORY: 'default-repo',
  },
  FLAG_QUIET: '--quiet',
}))

// Mock debug.
vi.mock('./debug.mts', () => ({
  debugDir: vi.fn(),
  debugFn: vi.fn(),
  debugGit: vi.fn(),
  debugLog: vi.fn(),
  isDebug: vi.fn(),
}))

describe('git utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
      const constants = await import('../constants.mts')
      constants.default.ENV.GITHUB_BASE_REF = 'main'

      const result = await getBaseBranch()
      expect(result).toBe('main')

      constants.default.ENV.GITHUB_BASE_REF = undefined
    })

    it('returns GITHUB_REF_NAME when it is a branch', async () => {
      const constants = await import('../constants.mts')
      constants.default.ENV.GITHUB_REF_TYPE = 'branch'
      constants.default.ENV.GITHUB_REF_NAME = 'feature-branch'

      const result = await getBaseBranch()
      expect(result).toBe('feature-branch')

      constants.default.ENV.GITHUB_REF_TYPE = undefined
      constants.default.ENV.GITHUB_REF_NAME = undefined
    })

    it('calls detectDefaultBranch when no GitHub env vars', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/registry/lib/spawn'),
      )
      spawn.mockResolvedValue({
        status: 0,
        stdout: 'main\n',
        stderr: '',
      } as any)

      const result = await getBaseBranch('/test/dir')
      expect(result).toBe('main')
    })
  })

  describe('gitBranch', () => {
    it('returns current branch name', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/registry/lib/spawn'),
      )
      spawn.mockResolvedValue({
        status: 0,
        stdout: 'feature-branch\n',
        stderr: '',
      } as any)

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
        await import('@socketsecurity/registry/lib/spawn'),
      )
      spawn
        .mockRejectedValueOnce(new Error('Not on a branch'))
        .mockResolvedValueOnce({
          status: 0,
          stdout: 'abc1234\n',
          stderr: '',
        } as any)

      const result = await gitBranch()
      expect(result).toBe('abc1234\n')
    })

    it('handles spawn errors', async () => {
      const { isSpawnError, spawn } = vi.mocked(
        await import('@socketsecurity/registry/lib/spawn'),
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
        await import('@socketsecurity/registry/lib/spawn'),
      )
      spawn.mockResolvedValue({ status: 0, stdout: '', stderr: '' } as any)

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
      const { spawn } = vi.mocked(
        await import('@socketsecurity/registry/lib/spawn'),
      )
      spawn.mockResolvedValue({ status: 0, stdout: '', stderr: '' } as any)

      const result = await gitCommit('Test commit', [], { cwd: '/test/dir' })
      expect(result).toBe(false)
      expect(spawn).not.toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['add']),
        expect.any(Object),
      )
    })
  })

  describe('gitCheckoutBranch', () => {
    it('checks out a branch', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/registry/lib/spawn'),
      )
      spawn.mockResolvedValue({ status: 0, stdout: '', stderr: '' } as any)

      const result = await gitCheckoutBranch('main')
      expect(result).toBe(true)
      expect(spawn).toHaveBeenCalledWith(
        'git',
        ['checkout', 'main'],
        expect.any(Object),
      )
    })
  })

  describe('gitCreateBranch', () => {
    it('creates a new branch', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/registry/lib/spawn'),
      )
      // gitLocalBranchExists fails.
      spawn
        .mockRejectedValueOnce(new Error('Branch does not exist'))
        // git branch succeeds.
        .mockResolvedValueOnce({ status: 0, stdout: '', stderr: '' } as any)

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
  })

  describe('gitDeleteBranch', () => {
    it('deletes a local branch', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/registry/lib/spawn'),
      )
      spawn.mockResolvedValue({ status: 0, stdout: '', stderr: '' } as any)

      const result = await gitDeleteBranch('old-feature')
      expect(result).toBe(true)
      expect(spawn).toHaveBeenCalledWith(
        'git',
        ['branch', '-D', 'old-feature'],
        expect.any(Object),
      )
    })
  })

  describe('gitPushBranch', () => {
    it('pushes a branch to remote', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/registry/lib/spawn'),
      )
      spawn.mockResolvedValue({ status: 0, stdout: '', stderr: '' } as any)

      const result = await gitPushBranch('feature')
      expect(result).toBe(true)
      expect(spawn).toHaveBeenCalledWith(
        'git',
        ['push', '--force', '--set-upstream', 'origin', 'feature'],
        expect.any(Object),
      )
    })
  })

  describe('gitCleanFdx', () => {
    it('cleans untracked files', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/registry/lib/spawn'),
      )
      spawn.mockResolvedValue({ status: 0, stdout: '', stderr: '' } as any)

      const result = await gitCleanFdx()
      expect(result).toBe(true)
      expect(spawn).toHaveBeenCalledWith(
        'git',
        ['clean', '-fdx'],
        expect.any(Object),
      )
    })
  })

  describe('gitResetHard', () => {
    it('resets to a specific ref', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/registry/lib/spawn'),
      )
      spawn.mockResolvedValue({ status: 0, stdout: '', stderr: '' } as any)

      const result = await gitResetHard('origin/main')
      expect(result).toBe(true)
      expect(spawn).toHaveBeenCalledWith(
        'git',
        ['reset', '--hard', 'origin/main'],
        expect.any(Object),
      )
    })
  })

  describe('gitEnsureIdentity', () => {
    it('sets git user name and email', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/registry/lib/spawn'),
      )
      spawn.mockResolvedValue({ status: 0, stdout: '', stderr: '' } as any)

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
  })
})
