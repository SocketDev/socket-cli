/**
 * Unit Tests: GHSA Fix Tracker Persistence Module — isGhsaFixed.
 *
 * Purpose: Tests the isGhsaFixed query operation of the GHSA fix tracker
 * system that maintains a persistent record of fixed GitHub Security
 * Advisories in .socket/fixed-ghsas.json. Validates querying fixed GHSA
 * status, including error handling for file system and shape failures.
 *
 * Testing Approach: Mocks @socketsecurity/lib/fs readJson to test tracker
 * queries without actual file I/O.
 *
 * Related Files: - src/commands/fix/ghsa-tracker.mts - GHSA tracker persistence
 * module - src/commands/fix/handle-fix.mts - Main fix command using tracker -
 * src/commands/fix/pull-request.mts - PR creation using tracker data.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isGhsaFixed } from '../../../../src/commands/fix/ghsa-tracker.mts'

import type { GhsaTracker } from '../../../../src/commands/fix/ghsa-tracker.mts'

// Mock file system operations.
const mockReadJson = vi.hoisted(() => vi.fn())

vi.mock(import('@socketsecurity/lib-stable/fs/read-json'), () => ({
  readJson: mockReadJson,
}))

describe('ghsa-tracker', () => {
  const mockCwd = '/test/repo'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('isGhsaFixed', () => {
    it('returns true for fixed GHSA', async () => {
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
      const tracker: GhsaTracker = {
        version: 1,
        fixed: [],
      }

      mockReadJson.mockResolvedValue(tracker)

      const result = await isGhsaFixed(mockCwd, 'GHSA-9999-9999-9999')

      expect(result).toBe(false)
    })

    it('returns false on error', async () => {
      mockReadJson.mockRejectedValue(new Error('Read error'))

      const result = await isGhsaFixed(mockCwd, 'GHSA-1234-5678-90ab')

      expect(result).toBe(false)
    })

    it('returns false when tracker shape is invalid (fixed.some throws)', async () => {
      // Resolve to a malformed tracker so .fixed.some() throws.
      mockReadJson.mockResolvedValue({ version: 1 })

      const result = await isGhsaFixed(mockCwd, 'GHSA-1234-5678-90ab')

      expect(result).toBe(false)
    })
  })
})
