/**
 * Unit tests for install completion output formatting.
 *
 * Purpose:
 * Tests the output formatting for tab completion installation results.
 *
 * Test Coverage:
 * - outputInstallCompletion function
 * - Success output with actions and instructions
 * - Error handling
 *
 * Related Files:
 * - src/commands/install/output-install-completion.mts (implementation)
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

import { outputInstallCompletion } from '../../../../src/commands/install/output-install-completion.mts'

import type { CResult } from '../../../../src/types.mts'

describe('output-install-completion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('outputInstallCompletion', () => {
    const mockSuccessData = {
      actions: ['Created completion script', 'Updated .bashrc'],
      bashrcPath: '/home/user/.bashrc',
      completionCommand: 'complete -F _socket socket',
      bashrcUpdated: true,
      foundBashrc: true,
      sourcingCommand: 'source ~/.socket/completion.bash',
      targetName: 'socket',
      targetPath: '/home/user/.socket/completion.bash',
    }

    describe('success output', () => {
      it('outputs installation complete message', async () => {
        const result: CResult<typeof mockSuccessData> = {
          ok: true,
          data: mockSuccessData,
        }

        await outputInstallCompletion(result)

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('Installation of tab completion')
        expect(logs).toContain('socket')
        expect(logs).toContain('finished!')
      })

      it('outputs all actions', async () => {
        const result: CResult<typeof mockSuccessData> = {
          ok: true,
          data: mockSuccessData,
        }

        await outputInstallCompletion(result)

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('Created completion script')
        expect(logs).toContain('Updated .bashrc')
      })

      it('outputs reload instructions', async () => {
        const result: CResult<typeof mockSuccessData> = {
          ok: true,
          data: mockSuccessData,
        }

        await outputInstallCompletion(result)

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('source ~/.bashrc')
        expect(logs).toContain(mockSuccessData.targetPath)
        expect(logs).toContain(mockSuccessData.completionCommand)
      })

      it('mentions automatic enablement in new terminals', async () => {
        const result: CResult<typeof mockSuccessData> = {
          ok: true,
          data: mockSuccessData,
        }

        await outputInstallCompletion(result)

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('automatically')
        expect(logs).toContain('new terminals')
      })
    })

    describe('error output', () => {
      it('outputs error with fail message', async () => {
        const result: CResult<typeof mockSuccessData> = {
          ok: false,
          message: 'Installation failed',
          cause: 'No write permission',
        }

        await outputInstallCompletion(result)

        expect(mockLogger.fail).toHaveBeenCalledWith(
          expect.stringContaining('Installation failed'),
        )
        expect(process.exitCode).toBe(1)
      })

      it('uses custom exit code when provided', async () => {
        const result: CResult<typeof mockSuccessData> = {
          ok: false,
          message: 'Failed',
          code: 127,
        }

        await outputInstallCompletion(result)

        expect(process.exitCode).toBe(127)
      })
    })
  })
})
