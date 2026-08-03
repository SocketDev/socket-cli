/**
 * Unit tests for git operations.
 *
 * Purpose: Tests repo info lookup, default-branch detection, remote-branch
 * existence checks, reset+clean, unstaged files, and git binary resolution.
 *
 * Related Files: - util/git/operations.mts (implementation)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetEnv } from '@socketsecurity/lib-stable/env/rewire'

import {
  listGitArgvTails,
  toGitArgvTail,
} from '../../../../test/helpers/git-spawn-assertions.mts'
import {
  detectDefaultBranch,
  getRepoInfo,
  getRepoName,
  getRepoOwner,
  gitDeleteRemoteBranch,
  gitLocalBranchExists,
  gitRemoteBranchExists,
  gitResetAndClean,
  gitUnstagedModifiedFiles,
} from '../../../../src/util/git/operations.mts'

// Mock spawn.
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/errors'), () => ({
  isSpawnError: vi.fn(e => e?.isSpawnError),
}))

// Pin git resolution so argv assertions do not depend on the host PATH.
vi.mock(
  import('../../../../src/util/trusted-executable.mts'),
  async importOriginal => ({
    ...(await importOriginal()),
    defaultProtectedRoot: vi.fn().mockResolvedValue('/repo'),
    resolveTrustedExecutable: vi.fn().mockResolvedValue({
      environment: { PATH: '/usr/bin' },
      executable: '/usr/bin/git',
    }),
  }),
)

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

  describe('getRepoInfo', () => {
    it('returns owner and repo from remote URL', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      spawn.mockResolvedValue({
        status: 0,
        stdout: 'git@github.com:socketdev/socket-cli.git',
        stderr: '',
      } as unknown)

      const result = await getRepoInfo('/test/dir')
      expect(result).toEqual({ owner: 'socketdev', repo: 'socket-cli' })
    })

    it('returns undefined when spawn fails', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      spawn.mockRejectedValue(new Error('Not a git repo'))

      const result = await getRepoInfo('/test/dir')
      expect(result).toBeUndefined()
    })

    it('returns undefined when spawn returns null', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      spawn.mockResolvedValue(undefined as unknown)

      const result = await getRepoInfo('/test/dir')
      expect(result).toBeUndefined()
    })

    it('returns undefined for unmatched git remote URL format (lines 142-145)', async () => {
      // Some private SSH config (e.g. host alias `myhost:owner/repo`) doesn't
      // match the parser's regex; the function falls through and the debug
      // logs fire.
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
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
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      spawn.mockResolvedValue({
        status: 0,
        stdout: 'git@github.com:socketdev/socket-cli.git',
        stderr: '',
      } as unknown)

      const result = await getRepoName('/test/dir')
      expect(result).toBe('socket-cli')
    })

    it('returns default when no repo info', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      spawn.mockRejectedValue(new Error('Not a git repo'))

      const result = await getRepoName('/test/dir')
      // Should return the default repository name.
      expect(typeof result).toBe('string')
    })
  })

  describe('getRepoOwner', () => {
    it('returns owner from remote URL', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      spawn.mockResolvedValue({
        status: 0,
        stdout: 'git@github.com:socketdev/socket-cli.git',
        stderr: '',
      } as unknown)

      const result = await getRepoOwner('/test/dir')
      expect(result).toBe('socketdev')
    })

    it('returns undefined when no repo info', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      spawn.mockRejectedValue(new Error('Not a git repo'))

      const result = await getRepoOwner('/test/dir')
      expect(result).toBeUndefined()
    })
  })

  describe('detectDefaultBranch', () => {
    it('returns main when it exists locally', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      spawn.mockResolvedValue({ status: 0, stdout: '', stderr: '' } as unknown)

      const result = await detectDefaultBranch('/test/dir')
      expect(result).toBe('main')
    })

    it('checks common branch names in order', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
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
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      // All local AND remote checks reject — exhaust both passes.
      spawn.mockRejectedValue(new Error('not found'))

      const result = await detectDefaultBranch('/test/dir')
      expect(result).toBe('socket-default-branch')
    })
  })

  describe('gitDeleteRemoteBranch', () => {
    it('deletes a remote branch', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      spawn.mockResolvedValue({ status: 0, stdout: '', stderr: '' } as unknown)

      const result = await gitDeleteRemoteBranch('old-feature')
      expect(result).toBe(true)
      expect(listGitArgvTails(spawn.mock.calls)).toContainEqual(
        toGitArgvTail(['push', '--delete'], ['origin', 'old-feature']),
      )
    })

    it('returns false when branch does not exist', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      spawn.mockRejectedValue(new Error('Branch not found'))

      const result = await gitDeleteRemoteBranch('nonexistent')
      expect(result).toBe(false)
    })
  })

  describe('gitLocalBranchExists', () => {
    it('returns true when branch exists', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      spawn.mockResolvedValue({ status: 0, stdout: '', stderr: '' } as unknown)

      const result = await gitLocalBranchExists('main')
      expect(result).toBe(true)
      expect(listGitArgvTails(spawn.mock.calls)).toContainEqual(
        toGitArgvTail(['show-ref', '--quiet'], ['refs/heads/main']),
      )
    })

    it('returns false when branch does not exist', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      spawn.mockRejectedValue(new Error('Branch not found'))

      const result = await gitLocalBranchExists('nonexistent')
      expect(result).toBe(false)
    })
  })

  describe('gitRemoteBranchExists', () => {
    it('returns true when remote branch exists', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      spawn.mockResolvedValue({
        status: 0,
        stdout: 'abc123\trefs/heads/main',
        stderr: '',
      } as unknown)

      const result = await gitRemoteBranchExists('main')
      expect(result).toBe(true)
      expect(listGitArgvTails(spawn.mock.calls)).toContainEqual(
        toGitArgvTail(['ls-remote', '--heads'], ['origin', 'main']),
      )
    })

    it('returns false when remote branch does not exist', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      spawn.mockResolvedValue({
        status: 0,
        stdout: '',
        stderr: '',
      } as unknown)

      const result = await gitRemoteBranchExists('nonexistent')
      expect(result).toBe(false)
    })

    it('returns false when spawn fails', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      spawn.mockRejectedValue(new Error('Network error'))

      const result = await gitRemoteBranchExists('main')
      expect(result).toBe(false)
    })
  })

  describe('gitResetAndClean', () => {
    it('calls gitResetHard and gitCleanFdx', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      spawn.mockResolvedValue({ status: 0, stdout: '', stderr: '' } as unknown)

      await gitResetAndClean('main', '/test/dir')
      expect(listGitArgvTails(spawn.mock.calls)).toContainEqual(
        toGitArgvTail(['reset', '--hard'], ['main']),
      )
      expect(listGitArgvTails(spawn.mock.calls)).toContainEqual(
        toGitArgvTail(['clean', '-fdx']),
      )
    })
  })

  describe('gitUnstagedModifiedFiles', () => {
    it('returns list of modified files', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
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
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      spawn.mockRejectedValue(new Error('Git error'))

      const result = await gitUnstagedModifiedFiles('/test/dir')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('Git Error')
      }
    })
  })

  describe('resolveGitExecutable', () => {
    it('throws when nothing runnable resolves outside the checkout', async () => {
      vi.resetModules()
      vi.doMock(import('../../../../src/util/trusted-executable.mts'), () => ({
        defaultProtectedRoot: vi.fn().mockResolvedValue('/repo'),
        findEnvPathValue: vi.fn().mockReturnValue('/usr/bin'),
        resolveTrustedExecutable: vi.fn().mockResolvedValue(undefined),
      }))
      const { resolveGitExecutable } =
        await import('../../../../src/util/git/operations.mts')
      await expect(resolveGitExecutable({ cwd: '/repo' })).rejects.toThrow(
        /Cannot resolve a trusted git executable/,
      )
      vi.doUnmock(import('../../../../src/util/trusted-executable.mts'))
      vi.resetModules()
    })
  })
})
