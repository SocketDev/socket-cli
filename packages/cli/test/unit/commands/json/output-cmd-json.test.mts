/**
 * Unit tests for json command output.
 *
 * Purpose:
 * Tests the output-cmd-json utility for displaying socket.json contents.
 *
 * Test Coverage:
 * - File not found handling
 * - Non-file (directory) handling
 * - Successful file reading
 *
 * Related Files:
 * - commands/json/output-cmd-json.mts (implementation)
 */

import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies.
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

vi.mock('node:fs', async () => {
  const actual = await vi.importActual('node:fs')
  return {
    ...actual,
    existsSync: vi.fn(),
  }
})

vi.mock('@socketsecurity/lib/fs', () => ({
  safeReadFileSync: vi.fn(),
  safeStatsSync: vi.fn(),
}))

import { existsSync } from 'node:fs'

import { safeReadFileSync, safeStatsSync } from '@socketsecurity/lib/fs'

import { outputCmdJson } from '../../../../src/commands/json/output-cmd-json.mts'

describe('output-cmd-json', () => {
  const originalExitCode = process.exitCode

  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  afterEach(() => {
    process.exitCode = originalExitCode
  })

  describe('outputCmdJson', () => {
    it('logs info about target cwd', async () => {
      vi.mocked(existsSync).mockReturnValue(false)

      await outputCmdJson('/test/path')

      expect(mockLogger.info).toHaveBeenCalledWith('Target cwd:', expect.any(String))
    })

    it('handles socket.json not found', async () => {
      vi.mocked(existsSync).mockReturnValue(false)

      await outputCmdJson('/test/path')

      expect(mockLogger.fail).toHaveBeenCalledWith(
        expect.stringContaining('Not found'),
      )
      expect(process.exitCode).toBe(1)
    })

    it('handles non-file (directory) path', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(safeStatsSync).mockReturnValue({
        isFile: () => false,
      } as any)

      await outputCmdJson('/test/path')

      expect(mockLogger.fail).toHaveBeenCalledWith(
        expect.stringContaining('not a regular file'),
      )
      expect(process.exitCode).toBe(1)
    })

    it('successfully reads and outputs socket.json contents', async () => {
      const mockContent = JSON.stringify({ version: '1.0.0' }, null, 2)
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(safeStatsSync).mockReturnValue({
        isFile: () => true,
      } as any)
      vi.mocked(safeReadFileSync).mockReturnValue(mockContent)

      await outputCmdJson('/test/path')

      expect(mockLogger.success).toHaveBeenCalledWith(
        expect.stringContaining('contents of'),
      )
      expect(mockLogger.log).toHaveBeenCalledWith(mockContent)
      expect(process.exitCode).toBeUndefined()
    })

    it('handles null safeStatsSync result', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(safeStatsSync).mockReturnValue(null)

      await outputCmdJson('/test/path')

      expect(mockLogger.fail).toHaveBeenCalled()
      expect(process.exitCode).toBe(1)
    })
  })
})
