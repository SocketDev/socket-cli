/**
 * Unit tests for config unset output formatting.
 *
 * Purpose:
 * Tests the output formatting for config unset results.
 *
 * Test Coverage:
 * - outputConfigUnset function
 * - JSON output format
 * - Text output format
 * - Markdown output format
 * - Error handling
 *
 * Related Files:
 * - src/commands/config/output-config-unset.mts (implementation)
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

vi.mock('../../../../src/utils/output/markdown.mts', () => ({
  mdHeader: (text: string) => `# ${text}`,
}))

vi.mock('../../../../src/utils/output/result-json.mjs', () => ({
  serializeResultJson: (result: unknown) => JSON.stringify(result, null, 2),
}))

import { outputConfigUnset } from '../../../../src/commands/config/output-config-unset.mts'

import type { CResult } from '../../../../src/types.mts'

describe('output-config-unset', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('outputConfigUnset', () => {
    describe('JSON output', () => {
      it('outputs success result as JSON', async () => {
        const result: CResult<string> = {
          ok: true,
          message: 'Config key removed',
          data: undefined,
        }

        await outputConfigUnset(result, 'json')

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('"ok": true'),
        )
      })

      it('outputs error result as JSON', async () => {
        const result: CResult<string> = {
          ok: false,
          message: 'Failed to unset config',
        }

        await outputConfigUnset(result, 'json')

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('"ok": false'),
        )
        expect(process.exitCode).toBe(1)
      })

      it('uses custom exit code when provided', async () => {
        const result: CResult<string> = {
          ok: false,
          message: 'Failed',
          code: 4,
        }

        await outputConfigUnset(result, 'json')

        expect(process.exitCode).toBe(4)
      })
    })

    describe('Text output', () => {
      it('outputs OK and message on success', async () => {
        const result: CResult<string> = {
          ok: true,
          message: 'Config key removed successfully',
          data: undefined,
        }

        await outputConfigUnset(result, 'text')

        expect(mockLogger.log).toHaveBeenCalledWith('OK')
        expect(mockLogger.log).toHaveBeenCalledWith(
          'Config key removed successfully',
        )
      })

      it('outputs additional data when provided', async () => {
        const result: CResult<string> = {
          ok: true,
          message: 'Config key removed',
          data: 'Previous value was: old-value',
        }

        await outputConfigUnset(result, 'text')

        expect(mockLogger.log).toHaveBeenCalledWith(
          'Previous value was: old-value',
        )
      })

      it('outputs error with fail message', async () => {
        const result: CResult<string> = {
          ok: false,
          message: 'Cannot unset key',
          cause: 'Key is required',
        }

        await outputConfigUnset(result, 'text')

        expect(mockLogger.fail).toHaveBeenCalledWith(
          expect.stringContaining('Cannot unset key'),
        )
        expect(process.exitCode).toBe(1)
      })
    })

    describe('Markdown output', () => {
      it('outputs update config header and message', async () => {
        const result: CResult<string> = {
          ok: true,
          message: 'Config key has been unset',
          data: undefined,
        }

        await outputConfigUnset(result, 'markdown')

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('# Update config')
        expect(logs).toContain('Config key has been unset')
      })

      it('outputs additional data in markdown', async () => {
        const result: CResult<string> = {
          ok: true,
          message: 'Unset complete',
          data: 'Additional info',
        }

        await outputConfigUnset(result, 'markdown')

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('Additional info')
      })
    })
  })
})
