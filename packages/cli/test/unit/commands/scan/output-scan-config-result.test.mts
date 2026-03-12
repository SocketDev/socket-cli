/**
 * Unit tests for scan config result output.
 *
 * Purpose:
 * Tests the output formatting for scan configuration results.
 *
 * Test Coverage:
 * - outputScanConfigResult function
 * - Success and error handling
 * - Exit code handling
 *
 * Related Files:
 * - src/commands/scan/output-scan-config-result.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock logger.
const mockLogger = vi.hoisted(() => ({
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  fail: vi.fn(),
  success: vi.fn(),
}))
vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))

// Mock failMsgWithBadge.
vi.mock('../../../../src/utils/error/fail-msg-with-badge.mts', () => ({
  failMsgWithBadge: (msg: string, cause?: string) =>
    cause ? `${msg}: ${cause}` : msg,
}))

import { outputScanConfigResult } from '../../../../src/commands/scan/output-scan-config-result.mts'

import type { CResult } from '../../../../src/types.mts'

describe('output-scan-config-result', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('outputScanConfigResult', () => {
    it('outputs success message', async () => {
      const result: CResult<unknown> = {
        ok: true,
        data: {},
      }

      await outputScanConfigResult(result)

      expect(mockLogger.log).toHaveBeenCalled()
      const logs = mockLogger.log.mock.calls.map(c => c[0]).join(' ')
      expect(logs).toContain('Finished')
      expect(process.exitCode).toBeUndefined()
    })

    it('outputs error with fail message', async () => {
      const result: CResult<unknown> = {
        ok: false,
        message: 'Config failed',
        cause: 'Invalid configuration',
      }

      await outputScanConfigResult(result)

      expect(mockLogger.fail).toHaveBeenCalledWith(
        expect.stringContaining('Config failed'),
      )
      expect(process.exitCode).toBe(1)
    })

    it('uses custom exit code when provided', async () => {
      const result: CResult<unknown> = {
        ok: false,
        message: 'Error',
        code: 2,
      }

      await outputScanConfigResult(result)

      expect(process.exitCode).toBe(2)
    })

    it('handles error without cause', async () => {
      const result: CResult<unknown> = {
        ok: false,
        message: 'Something went wrong',
      }

      await outputScanConfigResult(result)

      expect(mockLogger.fail).toHaveBeenCalled()
    })
  })
})
