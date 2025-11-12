/**
 * Unit Tests: GHSA Fix Tracker Persistence Module
 *
 * Purpose:
 * Tests the GHSA fix tracker system that maintains a persistent record of fixed GitHub Security
 * Advisories in .socket/fixed-ghsas.json. Validates tracker loading, saving, querying, and
 * updating operations to ensure the fix command can track which vulnerabilities have already
 * been addressed.
 *
 * Test Coverage:
 * - Loading existing tracker files and creating new trackers on first run
 * - Saving tracker data with proper directory creation
 * - Marking GHSAs as fixed with automatic deduplication
 * - Querying fixed GHSA status
 * - Retrieving all fixed GHSA records
 * - Error handling for file system failures
 * - Tracker record sorting by timestamp
 *
 * Testing Approach:
 * Mocks @socketsecurity/lib/fs functions (readJson, writeJson, safeMkdir) to test tracker
 * operations without actual file I/O. Tests verify correct file paths, data structures,
 * and error recovery behavior.
 *
 * Related Files:
 * - src/commands/fix/ghsa-tracker.mts - GHSA tracker persistence module
 * - src/commands/fix/handle-fix.mts - Main fix command using tracker
 * - src/commands/fix/pull-request.mts - PR creation using tracker data
 */

import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getFixedGhsas,
  isGhsaFixed,
  loadGhsaTracker,
  markGhsaFixed,
  saveGhsaTracker,
} from '../../../../src/commands/fix/ghsa-tracker.mts'

import type { GhsaTracker } from '../../../../src/commands/fix/ghsa-tracker.mts'

// Mock file system operations.
const mockReadJson = vi.hoisted(() => vi.fn())
const mockSafeMkdir = vi.hoisted(() => vi.fn())
const mockWriteJson = vi.hoisted(() => vi.fn())

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    promises: {
      ...actual.promises,
      mkdir: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
    },
  }
})

vi.mock('@socketsecurity/lib/fs', () => ({
  readJson: mockReadJson,
  safeMkdir: mockSafeMkdir,
  writeJson: mockWriteJson,
}))

describe('ghsa-tracker', () => {
  const mockCwd = '/test/repo'
  const trackerPath = path.join(mockCwd, '.socket/fixed-ghsas.json')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('loadGhsaTracker', () => {
    it('loads existing tracker file', async () => {
      const { readJson } = await import('@socketsecurity/lib/fs')
      const mockTracker: GhsaTracker = {
        version: 1,
        fixed: [
          {
            ghsaId: 'GHSA-1234-5678-90ab',
            fixedAt: '2025-01-01T00:00:00Z',
            prNumber: 123,
            branch: 'socket/fix/GHSA-1234-5678-90ab',
          },
        ],
      }

      mockReadJson.mockResolvedValue(mockTracker)

      const result = await loadGhsaTracker(mockCwd)

      expect(result).toEqual(mockTracker)
      expect(readJson).toHaveBeenCalledWith(trackerPath)
    })

    it('creates new tracker when file does not exist', async () => {
      const { readJson } = await import('@socketsecurity/lib/fs')
      mockReadJson.mockRejectedValue(new Error('ENOENT'))

      const result = await loadGhsaTracker(mockCwd)

      expect(result).toEqual({
        version: 1,
        fixed: [],
      })
    })

    it('handles null tracker data', async () => {
      const { readJson } = await import('@socketsecurity/lib/fs')
      mockReadJson.mockResolvedValue(null)

      const result = await loadGhsaTracker(mockCwd)

      expect(result).toEqual({
        version: 1,
        fixed: [],
      })
    })
  })

  describe('saveGhsaTracker', () => {
    it('saves tracker to file', async () => {
      const { safeMkdir, writeJson } = await import('@socketsecurity/lib/fs')
      const tracker: GhsaTracker = {
        version: 1,
        fixed: [
          {
            ghsaId: 'GHSA-1234-5678-90ab',
            fixedAt: '2025-01-01T00:00:00Z',
            prNumber: 123,
            branch: 'socket/fix/GHSA-1234-5678-90ab',
          },
        ],
      }

      await saveGhsaTracker(mockCwd, tracker)

      expect(safeMkdir).toHaveBeenCalledWith(path.dirname(trackerPath), {
        recursive: true,
      })
      expect(writeJson).toHaveBeenCalledWith(trackerPath, tracker, {
        spaces: 2,
      })
    })
  })

  describe('markGhsaFixed', () => {
    it('adds new GHSA fix record', async () => {
      const { readJson, writeJson } = await import('@socketsecurity/lib/fs')
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
      const { readJson, writeJson } = await import('@socketsecurity/lib/fs')
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
      const savedTracker = mockWriteJson.mock.calls[0]![1] as GhsaTracker
      expect(savedTracker.fixed).toHaveLength(1)
    })

    it('sorts records by fixedAt descending', async () => {
      const { readJson, writeJson } = await import('@socketsecurity/lib/fs')
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

      const savedTracker = mockWriteJson.mock.calls[0]![1] as GhsaTracker
      expect(savedTracker.fixed[0]!.ghsaId).toBe('GHSA-new')
      expect(savedTracker.fixed[1]!.ghsaId).toBe('GHSA-old')
    })

    it('handles errors gracefully', async () => {
      const { readJson } = await import('@socketsecurity/lib/fs')
      mockReadJson.mockRejectedValue(new Error('Permission denied'))

      // Should not throw.
      await expect(
        markGhsaFixed(mockCwd, 'GHSA-1234-5678-90ab', 123),
      ).resolves.toBeUndefined()
    })
  })

  describe('isGhsaFixed', () => {
    it('returns true for fixed GHSA', async () => {
      const { readJson } = await import('@socketsecurity/lib/fs')
      const tracker: GhsaTracker = {
        version: 1,
        fixed: [
          {
            ghsaId: 'GHSA-1234-5678-90ab',
            fixedAt: '2025-01-01T00:00:00Z',
            prNumber: 123,
            branch: 'socket/fix/GHSA-1234-5678-90ab',
          },
        ],
      }

      mockReadJson.mockResolvedValue(tracker)

      const result = await isGhsaFixed(mockCwd, 'GHSA-1234-5678-90ab')

      expect(result).toBe(true)
    })

    it('returns false for unfixed GHSA', async () => {
      const { readJson } = await import('@socketsecurity/lib/fs')
      const tracker: GhsaTracker = {
        version: 1,
        fixed: [],
      }

      mockReadJson.mockResolvedValue(tracker)

      const result = await isGhsaFixed(mockCwd, 'GHSA-9999-9999-9999')

      expect(result).toBe(false)
    })

    it('returns false on error', async () => {
      const { readJson } = await import('@socketsecurity/lib/fs')
      mockReadJson.mockRejectedValue(new Error('Read error'))

      const result = await isGhsaFixed(mockCwd, 'GHSA-1234-5678-90ab')

      expect(result).toBe(false)
    })
  })

  describe('getFixedGhsas', () => {
    it('returns all fixed GHSA records', async () => {
      const { readJson } = await import('@socketsecurity/lib/fs')
      const tracker: GhsaTracker = {
        version: 1,
        fixed: [
          {
            ghsaId: 'GHSA-1111-1111-1111',
            fixedAt: '2025-01-01T00:00:00Z',
            prNumber: 100,
            branch: 'socket/fix/GHSA-1111-1111-1111',
          },
          {
            ghsaId: 'GHSA-2222-2222-2222',
            fixedAt: '2025-01-02T00:00:00Z',
            prNumber: 200,
            branch: 'socket/fix/GHSA-2222-2222-2222',
          },
        ],
      }

      mockReadJson.mockResolvedValue(tracker)

      const result = await getFixedGhsas(mockCwd)

      expect(result).toEqual(tracker.fixed)
      expect(result).toHaveLength(2)
    })

    it('returns empty array on error', async () => {
      const { readJson } = await import('@socketsecurity/lib/fs')
      mockReadJson.mockRejectedValue(new Error('Read error'))

      const result = await getFixedGhsas(mockCwd)

      expect(result).toEqual([])
    })
  })
})
