/**
 * Unit tests for GitHub scan output formatting.
 *
 * Purpose:
 * Tests the output formatting for GitHub scan results.
 *
 * Test Coverage:
 * - outputScanGithub function
 * - JSON output format
 * - Text output format
 * - Success and error handling
 *
 * Related Files:
 * - src/commands/scan/output-scan-github.mts (implementation)
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

// Mock utilities.
vi.mock('../../../../src/utils/error/fail-msg-with-badge.mts', () => ({
  failMsgWithBadge: (msg: string, cause?: string) =>
    cause ? `${msg}: ${cause}` : msg,
}))

vi.mock('../../../../src/utils/output/result-json.mjs', () => ({
  serializeResultJson: (result: unknown) => JSON.stringify(result, null, 2),
}))

import { outputScanGithub } from '../../../../src/commands/scan/output-scan-github.mts'

import type { CResult } from '../../../../src/types.mts'

describe('output-scan-github', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('outputScanGithub', () => {
    describe('JSON output', () => {
      it('outputs success result as JSON', async () => {
        const result: CResult<{ scanId: string }> = {
          ok: true,
          data: { scanId: '123' },
        }

        await outputScanGithub(result, 'json')

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('"ok": true'),
        )
      })

      it('outputs error result as JSON', async () => {
        const result: CResult<unknown> = {
          ok: false,
          message: 'Scan failed',
          cause: 'Invalid repository',
        }

        await outputScanGithub(result, 'json')

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('"ok": false'),
        )
      })
    })

    describe('Text output', () => {
      it('outputs success message', async () => {
        const result: CResult<unknown> = {
          ok: true,
          data: {},
        }

        await outputScanGithub(result, 'text')

        expect(mockLogger.success).toHaveBeenCalledWith('Finished!')
        expect(mockLogger.log).toHaveBeenCalledWith('')
      })

      it('outputs error with fail message', async () => {
        const result: CResult<unknown> = {
          ok: false,
          message: 'Scan failed',
          cause: 'Invalid repository',
        }

        await outputScanGithub(result, 'text')

        expect(mockLogger.fail).toHaveBeenCalledWith(
          expect.stringContaining('Scan failed'),
        )
      })
    })
  })
})
