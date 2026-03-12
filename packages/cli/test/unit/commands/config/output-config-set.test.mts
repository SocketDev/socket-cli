/**
 * Unit tests for config set output formatting.
 *
 * Purpose:
 * Tests the output formatting for config set results.
 *
 * Test Coverage:
 * - outputConfigSet function
 * - JSON output format
 * - Text output format
 * - Markdown output format
 * - Error handling
 *
 * Related Files:
 * - src/commands/config/output-config-set.mts (implementation)
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

import { outputConfigSet } from '../../../../src/commands/config/output-config-set.mts'

import type { CResult } from '../../../../src/types.mts'

describe('output-config-set', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('outputConfigSet', () => {
    describe('JSON output', () => {
      it('outputs success result as JSON', async () => {
        const result: CResult<string> = {
          ok: true,
          message: 'Config updated',
          data: undefined,
        }

        await outputConfigSet(result, 'json')

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('"ok": true'),
        )
      })

      it('outputs error result as JSON', async () => {
        const result: CResult<string> = {
          ok: false,
          message: 'Failed to update config',
        }

        await outputConfigSet(result, 'json')

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('"ok": false'),
        )
        expect(process.exitCode).toBe(1)
      })

      it('uses custom exit code when provided', async () => {
        const result: CResult<string> = {
          ok: false,
          message: 'Failed',
          code: 3,
        }

        await outputConfigSet(result, 'json')

        expect(process.exitCode).toBe(3)
      })
    })

    describe('Text output', () => {
      it('outputs OK and message on success', async () => {
        const result: CResult<string> = {
          ok: true,
          message: 'Config key updated successfully',
          data: undefined,
        }

        await outputConfigSet(result, 'text')

        expect(mockLogger.log).toHaveBeenCalledWith('OK')
        expect(mockLogger.log).toHaveBeenCalledWith(
          'Config key updated successfully',
        )
      })

      it('outputs additional data when provided', async () => {
        const result: CResult<string> = {
          ok: true,
          message: 'Config key updated',
          data: 'Additional info here',
        }

        await outputConfigSet(result, 'text')

        expect(mockLogger.log).toHaveBeenCalledWith('Additional info here')
      })

      it('outputs error with fail message', async () => {
        const result: CResult<string> = {
          ok: false,
          message: 'Invalid key',
          cause: 'Key not supported',
        }

        await outputConfigSet(result, 'text')

        expect(mockLogger.fail).toHaveBeenCalledWith(
          expect.stringContaining('Invalid key'),
        )
        expect(process.exitCode).toBe(1)
      })
    })

    describe('Markdown output', () => {
      it('outputs update config header and message', async () => {
        const result: CResult<string> = {
          ok: true,
          message: 'Config updated successfully',
          data: undefined,
        }

        await outputConfigSet(result, 'markdown')

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('# Update config')
        expect(logs).toContain('Config updated successfully')
      })

      it('outputs additional data in markdown', async () => {
        const result: CResult<string> = {
          ok: true,
          message: 'Updated',
          data: 'More details',
        }

        await outputConfigSet(result, 'markdown')

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('More details')
      })
    })
  })
})
