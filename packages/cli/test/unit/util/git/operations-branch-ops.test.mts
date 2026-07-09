/**
 * Unit tests for git operations.
 *
 * Purpose: Tests branch checkout, creation, deletion, push, clean, reset,
 * and identity operations.
 *
 * Related Files: - util/git/operations.mts (implementation)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetEnv } from '@socketsecurity/lib-stable/env/rewire'

import {
  gitCheckoutBranch,
  gitCleanFdx,
  gitCreateBranch,
  gitDeleteBranch,
  gitEnsureIdentity,
  gitPushBranch,
  gitResetHard,
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

  describe('gitCheckoutBranch', () => {
    it('checks out a branch', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
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
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      spawn.mockRejectedValue(new Error('checkout failed'))

      const result = await gitCheckoutBranch('nonexistent')
      expect(result).toBe(false)
    })
  })

  describe('gitCreateBranch', () => {
    it('creates a new branch', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
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
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
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
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      spawn
        .mockRejectedValueOnce(new Error('Branch does not exist')) // gitLocalBranchExists fails.
        .mockRejectedValueOnce(new Error('branch creation failed')) // git branch fails.

      const result = await gitCreateBranch('bad-branch')
      expect(result).toBe(false)
    })
  })

  describe('gitDeleteBranch', () => {
    it('deletes a local branch', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
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
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      spawn.mockRejectedValue(new Error('branch does not exist'))

      const result = await gitDeleteBranch('nonexistent')
      expect(result).toBe(false)
    })
  })

  describe('gitPushBranch', () => {
    it('pushes a branch to remote', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
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
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      spawn.mockRejectedValue(new Error('network error'))

      const result = await gitPushBranch('feature')
      expect(result).toBe(false)
    })

    it('returns false on 128 spawn-error (token permissions, lines 305-311)', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      const { isSpawnError } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/errors'),
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
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
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
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      spawn.mockRejectedValue(new Error('clean failed'))

      const result = await gitCleanFdx()
      expect(result).toBe(false)
    })
  })

  describe('gitResetHard', () => {
    it('resets to a specific ref', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
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
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
      spawn.mockRejectedValue(new Error('reset failed'))

      const result = await gitResetHard('origin/main')
      expect(result).toBe(false)
    })
  })

  describe('gitEnsureIdentity', () => {
    it('sets git user name and email', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
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
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
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
      const { spawn } = vi.mocked(
        await import('@socketsecurity/lib-stable/process/spawn/child'),
      )
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
})
