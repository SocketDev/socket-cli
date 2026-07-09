/**
 * Unit Tests: GHSA Fix Tracker Persistence Module.
 *
 * Purpose: Tests the GHSA fix tracker system that maintains a persistent record
 * of fixed GitHub Security Advisories in .socket/fixed-ghsas.json. Validates
 * tracker loading, saving, querying, and updating operations to ensure the fix
 * command can track which vulnerabilities have already been addressed.
 *
 * Test Coverage: - Checking whether a tracked PID is still alive - Loading
 * existing tracker files and creating new trackers on first run - Saving
 * tracker data with proper directory creation.
 *
 * Testing Approach: Mocks @socketsecurity/lib/fs functions (readJson,
 * writeJson, safeMkdir) to test tracker operations without actual file I/O.
 * Tests verify correct file paths, data structures, and error recovery
 * behavior.
 *
 * Related Files: - src/commands/fix/ghsa-tracker.mts - GHSA tracker persistence
 * module - src/commands/fix/handle-fix.mts - Main fix command using tracker -
 * src/commands/fix/pull-request.mts - PR creation using tracker data.
 */

import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  isPidAlive,
  loadGhsaTracker,
  saveGhsaTracker,
} from '../../../../src/commands/fix/ghsa-tracker.mts'

import type { GhsaTracker } from '../../../../src/commands/fix/ghsa-tracker.mts'

// Mock file system operations.
const mockReadJson = vi.hoisted(() => vi.fn())
const mockSafeMkdir = vi.hoisted(() => vi.fn())
const mockWriteJson = vi.hoisted(() => vi.fn())

vi.mock(import('@socketsecurity/lib-stable/fs/read-json'), () => ({
  readJson: mockReadJson,
}))
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeMkdir: mockSafeMkdir,
}))
vi.mock(import('@socketsecurity/lib-stable/fs/write-json'), () => ({
  writeJson: mockWriteJson,
}))

describe('ghsa-tracker', () => {
  describe('isPidAlive', () => {
    it('returns true for the current process', () => {
      // process.kill(self, 0) is a no-op that succeeds when the process exists.
      expect(isPidAlive(process.pid)).toBe(true)
    })

    it('returns false for a PID that does not exist', () => {
      // PID 0 / very large PID throws ESRCH (no such process).
      expect(isPidAlive(2 ** 22)).toBe(false)
    })

    it('returns true when process.kill throws EPERM (alive but no permission)', () => {
      const original = process.kill
      ;(process as unknown).kill = () => {
        const e = new Error('Operation not permitted') as NodeJS.ErrnoException
        e.code = 'EPERM'
        throw e
      }
      try {
        expect(isPidAlive(1)).toBe(true)
      } finally {
        ;(process as unknown).kill = original
      }
    })

    it('returns false when process.kill throws non-EPERM (e.g. EINVAL)', () => {
      const original = process.kill
      ;(process as unknown).kill = () => {
        const e = new Error('Invalid') as NodeJS.ErrnoException
        e.code = 'EINVAL'
        throw e
      }
      try {
        expect(isPidAlive(1)).toBe(false)
      } finally {
        ;(process as unknown).kill = original
      }
    })
  })

  const mockCwd = '/test/repo'
  const trackerPath = path.join(mockCwd, '.socket/fixed-ghsas.json')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('loadGhsaTracker', () => {
    it('loads existing tracker file', async () => {
      const { readJson } =
        await import('@socketsecurity/lib-stable/fs/read-json')
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
      mockReadJson.mockRejectedValue(new Error('ENOENT'))

      const result = await loadGhsaTracker(mockCwd)

      expect(result).toEqual({
        version: 1,
        fixed: [],
      })
    })

    it('handles null tracker data', async () => {
      mockReadJson.mockResolvedValue(undefined)

      const result = await loadGhsaTracker(mockCwd)

      expect(result).toEqual({
        version: 1,
        fixed: [],
      })
    })
  })

  describe('saveGhsaTracker', () => {
    it('saves tracker to file', async () => {
      const { safeMkdir } = await import('@socketsecurity/lib-stable/fs/safe')
      const { writeJson } =
        await import('@socketsecurity/lib-stable/fs/write-json')
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
})
