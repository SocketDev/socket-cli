/**
 * Unit tests for uninstall completion output formatting.
 *
 * Purpose:
 * Tests the output formatting for tab completion uninstallation results.
 *
 * Test Coverage:
 * - outputUninstallCompletion function
 * - Success output with removal instructions
 * - Remaining completions notification
 * - Error handling
 *
 * Related Files:
 * - src/commands/uninstall/output-uninstall-completion.mts (implementation)
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

import { outputUninstallCompletion } from '../../../../src/commands/uninstall/output-uninstall-completion.mts'

import type { CResult } from '../../../../src/types.mts'

describe('output-uninstall-completion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('outputUninstallCompletion', () => {
    describe('success output', () => {
      it('outputs uninstall message', async () => {
        const result: CResult<{ action: string; left: string[] }> = {
          ok: true,
          message: 'Tab completion removed successfully',
          data: { action: 'removed', left: [] },
        }

        await outputUninstallCompletion(result, 'socket')

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('Tab completion removed successfully')
      })

      it('outputs complete -r command for manual removal', async () => {
        const result: CResult<{ action: string; left: string[] }> = {
          ok: true,
          message: 'Uninstalled',
          data: { action: 'removed', left: [] },
        }

        await outputUninstallCompletion(result, 'socket')

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('complete -r socket')
      })

      it('mentions tab completion will not be in next terminal', async () => {
        const result: CResult<{ action: string; left: string[] }> = {
          ok: true,
          message: 'Uninstalled',
          data: { action: 'removed', left: [] },
        }

        await outputUninstallCompletion(result, 'socket')

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('Next time you open a terminal')
        expect(logs).toContain('no longer be there')
      })

      it('lists remaining completions when present', async () => {
        const result: CResult<{ action: string; left: string[] }> = {
          ok: true,
          message: 'Uninstalled',
          data: { action: 'removed', left: ['socket-npm', 'socket-npx'] },
        }

        await outputUninstallCompletion(result, 'socket')

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('Detected more Socket Alias completions')
        expect(logs).toContain('socket-npm')
        expect(logs).toContain('socket-npx')
      })

      it('does not show remaining message when list is empty', async () => {
        const result: CResult<{ action: string; left: string[] }> = {
          ok: true,
          message: 'Uninstalled',
          data: { action: 'removed', left: [] },
        }

        await outputUninstallCompletion(result, 'socket')

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).not.toContain('Detected more Socket Alias completions')
      })

      it('uses target name in complete -r command', async () => {
        const result: CResult<{ action: string; left: string[] }> = {
          ok: true,
          message: 'Uninstalled',
          data: { action: 'removed', left: [] },
        }

        await outputUninstallCompletion(result, 'my-custom-command')

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('complete -r my-custom-command')
      })
    })

    describe('error output', () => {
      it('outputs error with fail message', async () => {
        const result: CResult<{ action: string; left: string[] }> = {
          ok: false,
          message: 'Uninstallation failed',
          cause: 'File not found',
        }

        await outputUninstallCompletion(result, 'socket')

        expect(mockLogger.fail).toHaveBeenCalledWith(
          expect.stringContaining('Uninstallation failed'),
        )
        expect(process.exitCode).toBe(1)
      })

      it('uses custom exit code when provided', async () => {
        const result: CResult<{ action: string; left: string[] }> = {
          ok: false,
          message: 'Failed',
          code: 2,
        }

        await outputUninstallCompletion(result, 'socket')

        expect(process.exitCode).toBe(2)
      })
    })
  })
})
