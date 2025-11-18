import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  cleanupErrorBranches,
  cleanupFailedPrBranches,
  cleanupStaleBranch,
  cleanupSuccessfulPrLocalBranch,
} from './branch-cleanup.mts'

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
}))

const mockDebugFn = vi.hoisted(() => vi.fn())

const mockGitDeleteBranch = vi.hoisted(() => vi.fn())
const mockGitDeleteRemoteBranch = vi.hoisted(() => vi.fn())

vi.mock('@socketsecurity/registry/lib/logger', () => ({
  logger: mockLogger,
}))

vi.mock('@socketsecurity/registry/lib/debug', () => ({
  debugFn: mockDebugFn,
}))

vi.mock('../../utils/git.mts', () => ({
  gitDeleteBranch: mockGitDeleteBranch,
  gitDeleteRemoteBranch: mockGitDeleteRemoteBranch,
}))

describe('branch-cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGitDeleteBranch.mockResolvedValue(true)
    mockGitDeleteRemoteBranch.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('cleanupStaleBranch', () => {
    it('should return true and delete both branches when remote deletion succeeds', async () => {
      const result = await cleanupStaleBranch(
        'socket-fix/GHSA-test',
        'GHSA-test',
        '/test/repo',
      )

      expect(result).toBe(true)
      expect(mockGitDeleteRemoteBranch).toHaveBeenCalledWith(
        'socket-fix/GHSA-test',
        '/test/repo',
      )
      expect(mockGitDeleteBranch).toHaveBeenCalledWith(
        'socket-fix/GHSA-test',
        '/test/repo',
      )
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Stale branch'),
      )
    })

    it('should return false and skip local deletion when remote deletion fails', async () => {
      mockGitDeleteRemoteBranch.mockResolvedValue(false)

      const result = await cleanupStaleBranch(
        'socket-fix/GHSA-test',
        'GHSA-test',
        '/test/repo',
      )

      expect(result).toBe(false)
      expect(mockGitDeleteRemoteBranch).toHaveBeenCalledWith(
        'socket-fix/GHSA-test',
        '/test/repo',
      )
      expect(mockGitDeleteBranch).not.toHaveBeenCalled()
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to delete stale remote branch'),
      )
    })
  })

  describe('cleanupFailedPrBranches', () => {
    it('should delete both remote and local branches', async () => {
      await cleanupFailedPrBranches('socket-fix/GHSA-test', '/test/repo')

      expect(mockGitDeleteRemoteBranch).toHaveBeenCalledWith(
        'socket-fix/GHSA-test',
        '/test/repo',
      )
      expect(mockGitDeleteBranch).toHaveBeenCalledWith(
        'socket-fix/GHSA-test',
        '/test/repo',
      )
    })

    it('should call functions in correct order (remote first, then local)', async () => {
      const calls: string[] = []
      mockGitDeleteRemoteBranch.mockImplementation(async () => {
        calls.push('remote')
        return true
      })
      mockGitDeleteBranch.mockImplementation(async () => {
        calls.push('local')
        return true
      })

      await cleanupFailedPrBranches('socket-fix/GHSA-test', '/test/repo')

      expect(calls).toEqual(['remote', 'local'])
    })
  })

  describe('cleanupSuccessfulPrLocalBranch', () => {
    it('should only delete local branch', async () => {
      await cleanupSuccessfulPrLocalBranch('socket-fix/GHSA-test', '/test/repo')

      expect(mockGitDeleteBranch).toHaveBeenCalledWith(
        'socket-fix/GHSA-test',
        '/test/repo',
      )
      expect(mockGitDeleteRemoteBranch).not.toHaveBeenCalled()
    })
  })

  describe('cleanupErrorBranches', () => {
    it('should delete both remote and local when remote exists', async () => {
      await cleanupErrorBranches('socket-fix/GHSA-test', '/test/repo', true)

      expect(mockGitDeleteRemoteBranch).toHaveBeenCalledWith(
        'socket-fix/GHSA-test',
        '/test/repo',
      )
      expect(mockGitDeleteBranch).toHaveBeenCalledWith(
        'socket-fix/GHSA-test',
        '/test/repo',
      )
    })

    it('should only delete local when remote does not exist', async () => {
      await cleanupErrorBranches('socket-fix/GHSA-test', '/test/repo', false)

      expect(mockGitDeleteRemoteBranch).not.toHaveBeenCalled()
      expect(mockGitDeleteBranch).toHaveBeenCalledWith(
        'socket-fix/GHSA-test',
        '/test/repo',
      )
    })

    it('should call functions in correct order when remote exists', async () => {
      const calls: string[] = []
      mockGitDeleteRemoteBranch.mockImplementation(async () => {
        calls.push('remote')
        return true
      })
      mockGitDeleteBranch.mockImplementation(async () => {
        calls.push('local')
        return true
      })

      await cleanupErrorBranches('socket-fix/GHSA-test', '/test/repo', true)

      expect(calls).toEqual(['remote', 'local'])
    })
  })
})
