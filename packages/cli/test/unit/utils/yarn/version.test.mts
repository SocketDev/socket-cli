/**
 * Unit tests for yarn version detection.
 *
 * Purpose:
 * Tests yarn version detection to determine Classic (1.x) vs Berry (2+).
 *
 * Test Coverage:
 * - isYarnBerry detection
 * - Version parsing
 * - Caching behavior
 * - Error handling
 *
 * Testing Approach:
 * Mocks spawnSync and getYarnBinPath to simulate different yarn versions.
 *
 * Related Files:
 * - utils/yarn/version.mts (implementation)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies before importing the module under test.
vi.mock('@socketsecurity/lib/spawn', () => ({
  spawnSync: vi.fn(),
}))

vi.mock('../../../../src/utils/yarn/paths.mts', () => ({
  getYarnBinPath: vi.fn(() => '/usr/bin/yarn'),
}))

describe('yarn version utilities', () => {
  let spawnSyncMock: ReturnType<typeof vi.fn>
  let getYarnBinPathMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    const spawnModule = await import('@socketsecurity/lib/spawn')
    const pathsModule = await import('../../../../src/utils/yarn/paths.mts')
    spawnSyncMock = spawnModule.spawnSync as ReturnType<typeof vi.fn>
    getYarnBinPathMock = pathsModule.getYarnBinPath as ReturnType<typeof vi.fn>
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  describe('isYarnBerry', () => {
    it('returns true for yarn 2.x', async () => {
      spawnSyncMock.mockReturnValue({
        status: 0,
        stdout: '2.4.3\n',
      })

      const { isYarnBerry } = await import(
        '../../../../src/utils/yarn/version.mts'
      )
      const result = isYarnBerry()

      expect(result).toBe(true)
      expect(getYarnBinPathMock).toHaveBeenCalled()
    })

    it('returns true for yarn 3.x', async () => {
      spawnSyncMock.mockReturnValue({
        status: 0,
        stdout: '3.6.1\n',
      })

      const { isYarnBerry } = await import(
        '../../../../src/utils/yarn/version.mts'
      )
      const result = isYarnBerry()

      expect(result).toBe(true)
    })

    it('returns true for yarn 4.x', async () => {
      spawnSyncMock.mockReturnValue({
        status: 0,
        stdout: '4.0.0',
      })

      const { isYarnBerry } = await import(
        '../../../../src/utils/yarn/version.mts'
      )
      const result = isYarnBerry()

      expect(result).toBe(true)
    })

    it('returns false for yarn 1.x (Classic)', async () => {
      spawnSyncMock.mockReturnValue({
        status: 0,
        stdout: '1.22.19\n',
      })

      const { isYarnBerry } = await import(
        '../../../../src/utils/yarn/version.mts'
      )
      const result = isYarnBerry()

      expect(result).toBe(false)
    })

    it('returns false when spawn fails', async () => {
      spawnSyncMock.mockReturnValue({
        status: 1,
        stdout: '',
      })

      const { isYarnBerry } = await import(
        '../../../../src/utils/yarn/version.mts'
      )
      const result = isYarnBerry()

      expect(result).toBe(false)
    })

    it('returns false when spawn returns non-zero status', async () => {
      spawnSyncMock.mockReturnValue({
        status: 127,
        stdout: Buffer.from(''),
      })

      const { isYarnBerry } = await import(
        '../../../../src/utils/yarn/version.mts'
      )
      const result = isYarnBerry()

      expect(result).toBe(false)
    })

    it('handles Buffer stdout', async () => {
      spawnSyncMock.mockReturnValue({
        status: 0,
        stdout: Buffer.from('3.0.0\n'),
      })

      const { isYarnBerry } = await import(
        '../../../../src/utils/yarn/version.mts'
      )
      const result = isYarnBerry()

      expect(result).toBe(true)
    })

    it('handles invalid version string', async () => {
      spawnSyncMock.mockReturnValue({
        status: 0,
        stdout: 'invalid-version\n',
      })

      const { isYarnBerry } = await import(
        '../../../../src/utils/yarn/version.mts'
      )
      const result = isYarnBerry()

      expect(result).toBe(false)
    })

    it('handles empty version string', async () => {
      spawnSyncMock.mockReturnValue({
        status: 0,
        stdout: '',
      })

      const { isYarnBerry } = await import(
        '../../../../src/utils/yarn/version.mts'
      )
      const result = isYarnBerry()

      expect(result).toBe(false)
    })

    it('returns false when an error is thrown', async () => {
      spawnSyncMock.mockImplementation(() => {
        throw new Error('spawn failed')
      })

      const { isYarnBerry } = await import(
        '../../../../src/utils/yarn/version.mts'
      )
      const result = isYarnBerry()

      expect(result).toBe(false)
    })

    it('caches result on subsequent calls', async () => {
      spawnSyncMock.mockReturnValue({
        status: 0,
        stdout: '3.0.0\n',
      })

      const { isYarnBerry } = await import(
        '../../../../src/utils/yarn/version.mts'
      )

      // Call multiple times.
      const result1 = isYarnBerry()
      const result2 = isYarnBerry()
      const result3 = isYarnBerry()

      expect(result1).toBe(true)
      expect(result2).toBe(true)
      expect(result3).toBe(true)

      // spawnSync should only be called once due to caching.
      expect(spawnSyncMock).toHaveBeenCalledTimes(1)
    })
  })
})
