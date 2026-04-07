/**
 * @fileoverview Unit tests for json command output.
 */

import fs from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))

const mockSafeReadFileSync = vi.fn()
const mockSafeStatsSync = vi.fn()

vi.mock('@socketsecurity/lib/fs', () => ({
  safeReadFileSync: (...args: unknown[]) => mockSafeReadFileSync(...args),
  safeStatsSync: (...args: unknown[]) => mockSafeStatsSync(...args),
}))

import { outputCmdJson } from '../../../../src/commands/json/output-cmd-json.mts'

describe('output-cmd-json', () => {
  const originalExitCode = process.exitCode
  let existsSyncSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    existsSyncSpy = vi.spyOn(fs, 'existsSync')
  })

  afterEach(() => {
    existsSyncSpy.mockRestore()
    process.exitCode = originalExitCode
  })

  describe('outputCmdJson', () => {
    it('logs info about target cwd', async () => {
      existsSyncSpy.mockReturnValue(false)

      await outputCmdJson('/test/path')

      expect(mockLogger.info).toHaveBeenCalledWith('Target cwd:', expect.any(String))
    })

    it('handles socket.json not found', async () => {
      existsSyncSpy.mockReturnValue(false)

      await outputCmdJson('/test/path')

      expect(mockLogger.fail).toHaveBeenCalledWith(
        expect.stringContaining('Not found'),
      )
      expect(process.exitCode).toBe(1)
    })

    it('handles non-file (directory) path', async () => {
      existsSyncSpy.mockReturnValue(true)
      mockSafeStatsSync.mockReturnValue({
        isFile: () => false,
      })

      await outputCmdJson('/test/path')

      expect(mockLogger.fail).toHaveBeenCalledWith(
        expect.stringContaining('not a regular file'),
      )
      expect(process.exitCode).toBe(1)
    })

    it('successfully reads and outputs socket.json contents', async () => {
      const mockContent = JSON.stringify({ version: '1.0.0' }, null, 2)
      existsSyncSpy.mockReturnValue(true)
      mockSafeStatsSync.mockReturnValue({
        isFile: () => true,
      })
      mockSafeReadFileSync.mockReturnValue(mockContent)

      await outputCmdJson('/test/path')

      expect(mockLogger.success).toHaveBeenCalledWith(
        expect.stringContaining('contents of'),
      )
      expect(mockLogger.log).toHaveBeenCalledWith(mockContent)
      expect(process.exitCode).toBeUndefined()
    })

    it('handles null safeStatsSync result', async () => {
      existsSyncSpy.mockReturnValue(true)
      mockSafeStatsSync.mockReturnValue(null)

      await outputCmdJson('/test/path')

      expect(mockLogger.fail).toHaveBeenCalled()
      expect(process.exitCode).toBe(1)
    })
  })
})
