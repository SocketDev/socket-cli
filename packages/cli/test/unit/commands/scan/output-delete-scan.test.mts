/**
 * Unit tests for delete scan output.
 *
 * Purpose:
 * Tests the outputDeleteScan function for different output formats.
 *
 * Test Coverage:
 * - JSON output format
 * - Text output format
 * - Error handling
 *
 * Related Files:
 * - commands/scan/output-delete-scan.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies.
const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))

vi.mock('../../../../src/utils/error/fail-msg-with-badge.mts', () => ({
  failMsgWithBadge: (message: string, cause?: string) =>
    cause ? `${message}: ${cause}` : message,
}))

vi.mock('../../../../src/utils/output/result-json.mjs', () => ({
  serializeResultJson: (result: any) => JSON.stringify(result),
}))

import { outputDeleteScan } from '../../../../src/commands/scan/output-delete-scan.mts'

describe('output-delete-scan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = 0
  })

  describe('outputDeleteScan', () => {
    it('outputs JSON for successful result', async () => {
      const result = {
        ok: true as const,
        data: { success: true },
      }

      await outputDeleteScan(result, 'json')

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('"ok":true'),
      )
    })

    it('outputs JSON for error result', async () => {
      const result = {
        ok: false as const,
        message: 'Delete failed',
        code: 1,
      }

      await outputDeleteScan(result, 'json')

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('"ok":false'),
      )
      expect(process.exitCode).toBe(1)
    })

    it('outputs text success message', async () => {
      const result = {
        ok: true as const,
        data: { success: true },
      }

      await outputDeleteScan(result, 'text')

      expect(mockLogger.success).toHaveBeenCalledWith(
        'Scan deleted successfully',
      )
    })

    it('outputs text error message', async () => {
      const result = {
        ok: false as const,
        message: 'Scan not found',
        cause: 'Invalid scan ID',
        code: 1,
      }

      await outputDeleteScan(result, 'text')

      expect(mockLogger.fail).toHaveBeenCalled()
      expect(process.exitCode).toBe(1)
    })

    it('sets default exit code when code is undefined', async () => {
      const result = {
        ok: false as const,
        message: 'Error occurred',
      }

      await outputDeleteScan(result, 'text')

      expect(process.exitCode).toBe(1)
    })
  })
})
