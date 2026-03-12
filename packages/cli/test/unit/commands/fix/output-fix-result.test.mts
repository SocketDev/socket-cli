/**
 * Unit tests for fix result output formatting.
 *
 * Purpose:
 * Tests the output formatting for fix command results.
 *
 * Test Coverage:
 * - outputFixResult function
 * - JSON output format
 * - Markdown output format
 * - Text output format
 * - Success and error handling
 *
 * Related Files:
 * - src/commands/fix/output-fix-result.mts (implementation)
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

vi.mock('../../../../src/utils/output/markdown.mts', () => ({
  mdError: (msg: string, cause?: string) =>
    `## Error: ${msg}${cause ? `\n${cause}` : ''}`,
  mdHeader: (text: string) => `# ${text}`,
}))

vi.mock('../../../../src/utils/output/result-json.mjs', () => ({
  serializeResultJson: (result: unknown) => JSON.stringify(result, null, 2),
}))

import { outputFixResult } from '../../../../src/commands/fix/output-fix-result.mts'

import type { CResult } from '../../../../src/types.mts'

describe('output-fix-result', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('outputFixResult', () => {
    describe('JSON output', () => {
      it('outputs success result as JSON', async () => {
        const result: CResult<{ fixed: number }> = {
          ok: true,
          data: { fixed: 5 },
        }

        await outputFixResult(result, 'json')

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('"ok": true'),
        )
        expect(process.exitCode).toBeUndefined()
      })

      it('outputs error result as JSON', async () => {
        const result: CResult<unknown> = {
          ok: false,
          message: 'Fix failed',
          cause: 'No vulnerabilities found',
        }

        await outputFixResult(result, 'json')

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('"ok": false'),
        )
        expect(process.exitCode).toBe(1)
      })

      it('uses custom exit code when provided', async () => {
        const result: CResult<unknown> = {
          ok: false,
          message: 'Fix failed',
          code: 2,
        }

        await outputFixResult(result, 'json')

        expect(process.exitCode).toBe(2)
      })
    })

    describe('Markdown output', () => {
      it('outputs success as markdown header', async () => {
        const result: CResult<unknown> = {
          ok: true,
          data: {},
        }

        await outputFixResult(result, 'markdown')

        expect(mockLogger.log).toHaveBeenCalledWith('# Fix Completed')
        expect(mockLogger.log).toHaveBeenCalledWith('✓ Finished!')
        expect(process.exitCode).toBeUndefined()
      })

      it('outputs error as markdown error', async () => {
        const result: CResult<unknown> = {
          ok: false,
          message: 'Fix failed',
          cause: 'No packages to fix',
        }

        await outputFixResult(result, 'markdown')

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('## Error: Fix failed'),
        )
        expect(process.exitCode).toBe(1)
      })
    })

    describe('Text output', () => {
      it('outputs success message', async () => {
        const result: CResult<unknown> = {
          ok: true,
          data: {},
        }

        await outputFixResult(result, 'text')

        expect(mockLogger.success).toHaveBeenCalledWith('Finished!')
        expect(mockLogger.log).toHaveBeenCalledWith('')
        expect(process.exitCode).toBeUndefined()
      })

      it('outputs error with fail message', async () => {
        const result: CResult<unknown> = {
          ok: false,
          message: 'Fix failed',
          cause: 'API error',
        }

        await outputFixResult(result, 'text')

        expect(mockLogger.fail).toHaveBeenCalledWith(
          expect.stringContaining('Fix failed'),
        )
        expect(process.exitCode).toBe(1)
      })

      it('handles error without cause', async () => {
        const result: CResult<unknown> = {
          ok: false,
          message: 'Something went wrong',
        }

        await outputFixResult(result, 'text')

        expect(mockLogger.fail).toHaveBeenCalledWith(
          expect.stringContaining('Something went wrong'),
        )
      })
    })
  })
})
