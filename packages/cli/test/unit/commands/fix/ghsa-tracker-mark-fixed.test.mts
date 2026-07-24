/**
 * Unit Tests: GHSA Fix Tracker Persistence Module — markGhsaFixed.
 *
 * Purpose: Tests the markGhsaFixed operation of the GHSA fix tracker system
 * that maintains a persistent record of fixed GitHub Security Advisories in
 * .socket/fixed-ghsas.json. Validates marking GHSAs as fixed with automatic
 * deduplication, record sorting by timestamp, and error handling.
 *
 * Testing Approach: Mocks @socketsecurity/lib/fs functions (readJson,
 * writeJson, safeMkdir) and node:fs promises (readFile, writeFile) to test
 * tracker operations without actual file I/O.
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

  describe('markGhsaFixed', () => {
    it('adds new GHSA fix record', async () => {
      const { writeJson } =
        await import('@socketsecurity/lib-stable/fs/write-json')
      const existingTracker: GhsaTracker = {
        version: 1,
        fixed: [],
      }

      mockReadJson.mockResolvedValue(existingTracker)

      await markGhsaFixed(mockCwd, 'GHSA-1234-5678-90ab', 123)

      expect(writeJson).toHaveBeenCalledWith(
        trackerPath,
        expect.objectContaining({
          version: 1,
          fixed: expect.arrayContaining([
            expect.objectContaining({
              ghsaId: 'GHSA-1234-5678-90ab',
              prNumber: 123,
              branch: 'socket/fix/GHSA-1234-5678-90ab',
            }),
          ]),
        }),
        { spaces: 2 },
      )
    })

    it('replaces existing GHSA fix record', async () => {
      const { writeJson } =
        await import('@socketsecurity/lib-stable/fs/write-json')
      const existingTracker: GhsaTracker = {
        version: 1,
        fixed: [
          {
            ghsaId: 'GHSA-1234-5678-90ab',
            fixedAt: '2025-01-01T00:00:00Z',
            prNumber: 100,
            branch: 'socket/fix/GHSA-1234-5678-90ab',
          },
        ],
      }

      mockReadJson.mockResolvedValue(existingTracker)

      await markGhsaFixed(mockCwd, 'GHSA-1234-5678-90ab', 200)

      expect(writeJson).toHaveBeenCalledWith(
        trackerPath,
        expect.objectContaining({
          version: 1,
          fixed: [
            expect.objectContaining({
              ghsaId: 'GHSA-1234-5678-90ab',
              prNumber: 200,
            }),
          ],
        }),
        { spaces: 2 },
      )

      // Verify only one record exists (old one was removed).
      const savedTracker = mockWriteJson.mock.calls[0][1] as GhsaTracker
      expect(savedTracker.fixed).toHaveLength(1)
    })

    it('sorts records by fixedAt descending', async () => {
      const existingTracker: GhsaTracker = {
        version: 1,
        fixed: [
          {
            ghsaId: 'GHSA-old',
            fixedAt: '2025-01-01T00:00:00Z',
            prNumber: 100,
            branch: 'socket/fix/GHSA-old',
          },
        ],
      }

      mockReadJson.mockResolvedValue(existingTracker)

      // Add a new record with a later timestamp.
      await markGhsaFixed(mockCwd, 'GHSA-new', 200)

      const savedTracker = mockWriteJson.mock.calls[0][1] as GhsaTracker
      expect(savedTracker.fixed[0].ghsaId).toBe('GHSA-new')
      expect(savedTracker.fixed[1].ghsaId).toBe('GHSA-old')
    })

    it('handles errors gracefully', async () => {
      mockReadJson.mockRejectedValue(new Error('Permission denied'))

      // Should not throw.
      await expect(
        markGhsaFixed(mockCwd, 'GHSA-1234-5678-90ab', 123),
      ).resolves.toBeUndefined()
    })
  })
})
