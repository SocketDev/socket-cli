/** @fileoverview Tests for SEA (Single Executable Application) detection utilities. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getSeaBinaryPath, isSeaBinary } from './sea.mts'

// Mock stub-ipc module
vi.mock('./stub-ipc.mts', () => ({
  getStubPath: vi.fn(),
  isRunningViaSea: vi.fn(),
}))

describe('SEA detection utilities', () => {
  beforeEach(async () => {
    // Clear all mocks before each test.
    vi.clearAllMocks()
  })

  describe('isSeaBinary', () => {
    it('returns false when not running via SEA', async () => {
      const { isRunningViaSea } = await import('./stub-ipc.mts')
      vi.mocked(isRunningViaSea).mockReturnValue(false)

      const result = isSeaBinary()

      expect(result).toBe(false)
      expect(isRunningViaSea).toHaveBeenCalled()
    })

    it('returns true when running via SEA', async () => {
      const { isRunningViaSea } = await import('./stub-ipc.mts')
      vi.mocked(isRunningViaSea).mockReturnValue(true)

      const result = isSeaBinary()

      expect(result).toBe(true)
      expect(isRunningViaSea).toHaveBeenCalled()
    })

    it('delegates to stub-ipc isRunningViaSea function', async () => {
      const { isRunningViaSea } = await import('./stub-ipc.mts')
      vi.mocked(isRunningViaSea).mockReturnValue(false)

      isSeaBinary()

      expect(isRunningViaSea).toHaveBeenCalledTimes(1)
    })
  })

  describe('getSeaBinaryPath', () => {
    it('returns undefined when not running via SEA', async () => {
      const { getStubPath } = await import('./stub-ipc.mts')
      vi.mocked(getStubPath).mockReturnValue(undefined)

      const result = getSeaBinaryPath()

      expect(result).toBeUndefined()
      expect(getStubPath).toHaveBeenCalled()
    })

    it('returns stub path when running via SEA', async () => {
      const { getStubPath } = await import('./stub-ipc.mts')
      const stubPath = '/path/to/socket-cli-stub'
      vi.mocked(getStubPath).mockReturnValue(stubPath)

      const result = getSeaBinaryPath()

      expect(result).toBe(stubPath)
      expect(getStubPath).toHaveBeenCalled()
    })

    it('delegates to stub-ipc getStubPath function', async () => {
      const { getStubPath } = await import('./stub-ipc.mts')
      vi.mocked(getStubPath).mockReturnValue('/some/path')

      getSeaBinaryPath()

      expect(getStubPath).toHaveBeenCalledTimes(1)
    })

    it('handles different stub paths correctly', async () => {
      const { getStubPath } = await import('./stub-ipc.mts')
      const testPaths = [
        '/usr/local/bin/socket',
        'C:\\Program Files\\Socket\\socket.exe',
        '/home/user/.local/bin/socket',
      ]

      for (const testPath of testPaths) {
        vi.clearAllMocks()
        vi.mocked(getStubPath).mockReturnValue(testPath)
        const result = getSeaBinaryPath()
        expect(result).toBe(testPath)
      }
    })
  })
})
