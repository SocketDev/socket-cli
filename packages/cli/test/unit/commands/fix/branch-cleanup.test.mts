/**
 * Unit tests for branch cleanup utilities.
 *
 * Purpose:
 * Tests the branch lifecycle management for the fix command.
 *
 * Test Coverage:
 * - cleanupStaleBranch function
 * - cleanupFailedPrBranches function
 * - cleanupSuccessfulPrLocalBranch function
 * - cleanupErrorBranches function
 *
 * Related Files:
 * - src/commands/fix/branch-cleanup.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock logger.
const mockLogger = vi.hoisted(() => ({
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  fail: vi.fn(),
  success: vi.fn(),
}))
vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))

// Mock git operations.
const mockGitDeleteBranch = vi.hoisted(() => vi.fn())
const mockGitDeleteRemoteBranch = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/utils/git/operations.mjs', () => ({
  gitDeleteBranch: mockGitDeleteBranch,
  gitDeleteRemoteBranch: mockGitDeleteRemoteBranch,
}))

import {
  cleanupErrorBranches,
  cleanupFailedPrBranches,
  cleanupStaleBranch,
  cleanupSuccessfulPrLocalBranch,
} from '../../../../src/commands/fix/branch-cleanup.mts'

describe('branch-cleanup', () => {
  const cwd = '/test/repo'
  const branch = 'socket/fix/GHSA-1234-5678-90ab'
  const ghsaId = 'GHSA-1234-5678-90ab'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('cleanupStaleBranch', () => {
    it('deletes remote and local branches when remote deletion succeeds', async () => {
      mockGitDeleteRemoteBranch.mockResolvedValue(true)
      mockGitDeleteBranch.mockResolvedValue(undefined)

      const result = await cleanupStaleBranch(branch, ghsaId, cwd)

      expect(result).toBe(true)
      expect(mockGitDeleteRemoteBranch).toHaveBeenCalledWith(branch, cwd)
      expect(mockGitDeleteBranch).toHaveBeenCalledWith(branch, cwd)
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Stale branch'),
      )
    })

    it('returns false when remote deletion fails', async () => {
      mockGitDeleteRemoteBranch.mockResolvedValue(false)

      const result = await cleanupStaleBranch(branch, ghsaId, cwd)

      expect(result).toBe(false)
      expect(mockGitDeleteRemoteBranch).toHaveBeenCalledWith(branch, cwd)
      expect(mockGitDeleteBranch).not.toHaveBeenCalled()
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to delete stale remote branch'),
      )
    })

    it('logs warning about stale branch', async () => {
      mockGitDeleteRemoteBranch.mockResolvedValue(true)

      await cleanupStaleBranch(branch, ghsaId, cwd)

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining(branch),
      )
    })
  })

  describe('cleanupFailedPrBranches', () => {
    it('deletes both remote and local branches', async () => {
      mockGitDeleteRemoteBranch.mockResolvedValue(true)
      mockGitDeleteBranch.mockResolvedValue(undefined)

      await cleanupFailedPrBranches(branch, cwd)

      expect(mockGitDeleteRemoteBranch).toHaveBeenCalledWith(branch, cwd)
      expect(mockGitDeleteBranch).toHaveBeenCalledWith(branch, cwd)
    })

    it('continues to delete local branch even if remote fails', async () => {
      mockGitDeleteRemoteBranch.mockResolvedValue(false)
      mockGitDeleteBranch.mockResolvedValue(undefined)

      await cleanupFailedPrBranches(branch, cwd)

      expect(mockGitDeleteRemoteBranch).toHaveBeenCalledWith(branch, cwd)
      expect(mockGitDeleteBranch).toHaveBeenCalledWith(branch, cwd)
    })
  })

  describe('cleanupSuccessfulPrLocalBranch', () => {
    it('deletes only local branch, keeping remote for PR', async () => {
      mockGitDeleteBranch.mockResolvedValue(undefined)

      await cleanupSuccessfulPrLocalBranch(branch, cwd)

      expect(mockGitDeleteBranch).toHaveBeenCalledWith(branch, cwd)
      expect(mockGitDeleteRemoteBranch).not.toHaveBeenCalled()
    })
  })

  describe('cleanupErrorBranches', () => {
    it('deletes both remote and local when remote exists', async () => {
      mockGitDeleteRemoteBranch.mockResolvedValue(true)
      mockGitDeleteBranch.mockResolvedValue(undefined)

      await cleanupErrorBranches(branch, cwd, true)

      expect(mockGitDeleteRemoteBranch).toHaveBeenCalledWith(branch, cwd)
      expect(mockGitDeleteBranch).toHaveBeenCalledWith(branch, cwd)
    })

    it('deletes only local branch when remote does not exist', async () => {
      mockGitDeleteBranch.mockResolvedValue(undefined)

      await cleanupErrorBranches(branch, cwd, false)

      expect(mockGitDeleteRemoteBranch).not.toHaveBeenCalled()
      expect(mockGitDeleteBranch).toHaveBeenCalledWith(branch, cwd)
    })
  })
})
