/**
 * Unit tests for reachability scan output formatting.
 *
 * Purpose:
 * Tests the output formatting for reachability analysis results.
 *
 * Test Coverage:
 * - outputScanReach function
 * - JSON output format
 * - Text output format
 * - Output path handling
 * - Exit code handling
 *
 * Related Files:
 * - src/commands/scan/output-scan-reach.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock logger.
const mockLogger = vi.hoisted(() => ({
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  fail: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
}))
vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))

// Mock utilities.
vi.mock('../../../../src/utils/error/fail-msg-with-badge.mts', () => ({
  failMsgWithBadge: (msg: string, cause?: string) =>
    cause ? `${msg}: ${cause}` : msg,
}))

vi.mock('../../../../src/utils/output/result-json.mjs', () => ({
  serializeResultJson: (result: unknown) => JSON.stringify(result, null, 2),
}))

import { outputScanReach } from '../../../../src/commands/scan/output-scan-reach.mts'

import type { CResult } from '../../../../src/types.mts'

describe('output-scan-reach', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('outputScanReach', () => {
    describe('JSON output', () => {
      it('outputs success result as JSON', async () => {
        const result: CResult<{ reachable: number }> = {
          ok: true,
          data: { reachable: 5 },
        }

        await outputScanReach(result, {
          cwd: '/test',
          outputKind: 'json',
          outputPath: '',
        })

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('"ok": true'),
        )
      })

      it('outputs error result as JSON', async () => {
        const result: CResult<unknown> = {
          ok: false,
          message: 'Analysis failed',
        }

        await outputScanReach(result, {
          cwd: '/test',
          outputKind: 'json',
          outputPath: '',
        })

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('"ok": false'),
        )
      })
    })

    describe('Text output', () => {
      it('outputs success message with default path', async () => {
        const result: CResult<{ reachable: number }> = {
          ok: true,
          data: { reachable: 5 },
        }

        await outputScanReach(result, {
          cwd: '/test',
          outputKind: 'text',
          outputPath: '',
        })

        expect(mockLogger.success).toHaveBeenCalledWith(
          'Reachability analysis completed successfully!',
        )
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining('.socket.facts.json'),
        )
      })

      it('outputs success message with custom path', async () => {
        const result: CResult<{ reachable: number }> = {
          ok: true,
          data: { reachable: 5 },
        }

        await outputScanReach(result, {
          cwd: '/test',
          outputKind: 'text',
          outputPath: '/custom/output.json',
        })

        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining('/custom/output.json'),
        )
      })

      it('outputs error with fail message', async () => {
        const result: CResult<unknown> = {
          ok: false,
          message: 'Analysis failed',
          cause: 'No dependencies found',
        }

        await outputScanReach(result, {
          cwd: '/test',
          outputKind: 'text',
          outputPath: '',
        })

        expect(mockLogger.fail).toHaveBeenCalledWith(
          expect.stringContaining('Analysis failed'),
        )
      })

      it('sets exit code on error', async () => {
        const result: CResult<unknown> = {
          ok: false,
          message: 'Failed',
        }

        await outputScanReach(result, {
          cwd: '/test',
          outputKind: 'text',
          outputPath: '',
        })

        expect(process.exitCode).toBe(1)
      })

      it('uses custom exit code when provided', async () => {
        const result: CResult<unknown> = {
          ok: false,
          message: 'Failed',
          code: 2,
        }

        await outputScanReach(result, {
          cwd: '/test',
          outputKind: 'text',
          outputPath: '',
        })

        expect(process.exitCode).toBe(2)
      })
    })
  })
})
