/**
 * Unit Tests: GHSA Fix Tracker Persistence Module — markGhsaFixed locking.
 *
 * Purpose: Tests the file-locking behavior of markGhsaFixed in the GHSA fix
 * tracker system that maintains a persistent record of fixed GitHub Security
 * Advisories in .socket/fixed-ghsas.json. Validates lock acquisition, stale
 * lock detection, lock release, and graceful degradation when locking fails.
 *
 * Testing Approach: Mocks @socketsecurity/lib/fs functions (readJson,
 * writeJson, safeMkdir, safeDelete) and node:fs promises (readFile,
 * writeFile) to exercise tracker locking without touching a real disk.
 *
 * Related Files: - src/commands/fix/ghsa-tracker.mts - GHSA tracker persistence
 * module - src/commands/fix/handle-fix.mts - Main fix command using tracker -
 * src/commands/fix/pull-request.mts - PR creation using tracker data.
 */

import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { markGhsaFixed } from '../../../../src/commands/fix/ghsa-tracker.mts'

import type { GhsaTracker } from '../../../../src/commands/fix/ghsa-tracker.mts'

import type * as FsModule from 'node:fs'

// Mock file system operations.
const mockReadJson = vi.hoisted(() => vi.fn())
const mockSafeDelete = vi.hoisted(() => vi.fn())
const mockSafeMkdir = vi.hoisted(() => vi.fn())
const mockWriteJson = vi.hoisted(() => vi.fn())

// Mock fs promises.
const mockFsWriteFile = vi.hoisted(() => vi.fn())
const mockFsReadFile = vi.hoisted(() => vi.fn())

vi.mock(import('node:fs'), async () => {
  const actual = await vi.importActual<typeof FsModule>('node:fs')
  return {
    ...actual,
    promises: {
      ...actual.promises,
      mkdir: vi.fn(),
      readFile: mockFsReadFile,
      writeFile: mockFsWriteFile,
    },
  }
})

vi.mock(import('@socketsecurity/lib-stable/fs/read-json'), () => ({
  readJson: mockReadJson,
}))
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeDelete: mockSafeDelete,
  safeMkdir: mockSafeMkdir,
}))
vi.mock(import('@socketsecurity/lib-stable/fs/write-json'), () => ({
  writeJson: mockWriteJson,
}))

describe('ghsa-tracker', () => {
  const mockCwd = '/test/repo'
  const trackerPath = path.join(mockCwd, '.socket/fixed-ghsas.json')

  beforeEach(() => {
    vi.clearAllMocks()
    // Default: lock file creation succeeds.
    mockFsWriteFile.mockResolvedValue(undefined)
    mockFsReadFile.mockResolvedValue('12345')
    mockSafeDelete.mockResolvedValue(undefined)
  })

  describe('markGhsaFixed with locking', () => {
    it('uses custom branch name when provided', async () => {
      const { writeJson } =
        await import('@socketsecurity/lib-stable/fs/write-json')
      const existingTracker: GhsaTracker = {
        version: 1,
        fixed: [],
      }

      mockReadJson.mockResolvedValue(existingTracker)

      await markGhsaFixed(mockCwd, 'GHSA-1234-5678-90ab', 123, 'custom-branch')

      expect(writeJson).toHaveBeenCalledWith(
        trackerPath,
        expect.objectContaining({
          fixed: expect.arrayContaining([
            expect.objectContaining({
              ghsaId: 'GHSA-1234-5678-90ab',
              branch: 'custom-branch',
            }),
          ]),
        }),
        { spaces: 2 },
      )
    })

    it('omits prNumber when not provided', async () => {
      const existingTracker: GhsaTracker = {
        version: 1,
        fixed: [],
      }

      mockReadJson.mockResolvedValue(existingTracker)

      await markGhsaFixed(mockCwd, 'GHSA-no-pr', undefined)

      const savedTracker = mockWriteJson.mock.calls[0]![1] as GhsaTracker
      const record = savedTracker.fixed.find(r => r.ghsaId === 'GHSA-no-pr')
      expect(record).toBeDefined()
      expect(record!.prNumber).toBeUndefined()
    })

    it('handles lock file already exists (EEXIST)', async () => {
      const existingTracker: GhsaTracker = {
        version: 1,
        fixed: [],
      }

      // First call to writeFile fails with EEXIST, subsequent succeeds.
      const eexistError = new Error('Lock exists') as NodeJS.ErrnoException
      eexistError.code = 'EEXIST'
      mockFsWriteFile.mockRejectedValueOnce(eexistError)
      mockFsWriteFile.mockResolvedValueOnce(undefined)

      // Mock reading lock file to show stale lock (dead process).
      mockFsReadFile.mockResolvedValueOnce('99999999')

      mockReadJson.mockResolvedValue(existingTracker)

      await markGhsaFixed(mockCwd, 'GHSA-lock-test', 123)

      // Should still save the tracker.
      expect(mockWriteJson).toHaveBeenCalled()
    })

    it('handles lock file read error', async () => {
      const existingTracker: GhsaTracker = {
        version: 1,
        fixed: [],
      }

      // First call to writeFile fails with EEXIST.
      const eexistError = new Error('Lock exists') as NodeJS.ErrnoException
      eexistError.code = 'EEXIST'
      mockFsWriteFile.mockRejectedValueOnce(eexistError)
      mockFsWriteFile.mockResolvedValueOnce(undefined)

      // Mock reading lock file fails.
      mockFsReadFile.mockRejectedValueOnce(new Error('Read error'))

      mockReadJson.mockResolvedValue(existingTracker)

      await markGhsaFixed(mockCwd, 'GHSA-lock-read-error', 123)

      // Should still save the tracker (proceeds without lock).
      expect(mockWriteJson).toHaveBeenCalled()
    })

    it('handles lock file with invalid PID', async () => {
      const existingTracker: GhsaTracker = {
        version: 1,
        fixed: [],
      }

      // First call to writeFile fails with EEXIST.
      const eexistError = new Error('Lock exists') as NodeJS.ErrnoException
      eexistError.code = 'EEXIST'
      mockFsWriteFile.mockRejectedValueOnce(eexistError)
      mockFsWriteFile.mockResolvedValueOnce(undefined)

      // Mock reading lock file with invalid PID.
      mockFsReadFile.mockResolvedValueOnce('not-a-number')

      mockReadJson.mockResolvedValue(existingTracker)

      await markGhsaFixed(mockCwd, 'GHSA-invalid-pid', 123)

      // Should proceed anyway.
      expect(mockWriteJson).toHaveBeenCalled()
    })

    it('releases lock after successful operation', async () => {
      const existingTracker: GhsaTracker = {
        version: 1,
        fixed: [],
      }

      mockReadJson.mockResolvedValue(existingTracker)

      await markGhsaFixed(mockCwd, 'GHSA-release-lock', 123)

      // Confirms the lock cleanup path runs via safeDelete.
      expect(mockSafeDelete).toHaveBeenCalled()
    })

    it('proceeds without lock when all attempts fail', async () => {
      const existingTracker: GhsaTracker = {
        version: 1,
        fixed: [],
      }

      // All lock attempts fail with non-EEXIST error.
      mockFsWriteFile.mockRejectedValue(new Error('Permission denied'))

      mockReadJson.mockResolvedValue(existingTracker)

      await markGhsaFixed(mockCwd, 'GHSA-no-lock', 123)

      // Should still save the tracker.
      expect(mockWriteJson).toHaveBeenCalled()
    })

    it('swallows write failure inside the inner catch arm', async () => {
      const existingTracker: GhsaTracker = {
        version: 1,
        fixed: [],
      }

      mockReadJson.mockResolvedValue(existingTracker)
      mockWriteJson.mockRejectedValueOnce(new Error('write failed'))

      // Should not throw — the inner catch logs + swallows.
      await expect(
        markGhsaFixed(mockCwd, 'GHSA-write-fail', 123),
      ).resolves.toBeUndefined()
    })
  })
})
