/**
 * Unit tests for manifest setup output formatting.
 *
 * Purpose:
 * Tests the output formatting for manifest setup results.
 *
 * Test Coverage:
 * - outputManifestSetup function
 * - Success output
 * - Error handling
 *
 * Related Files:
 * - src/commands/manifest/output-manifest-setup.mts (implementation)
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

import { outputManifestSetup } from '../../../../src/commands/manifest/output-manifest-setup.mts'

import type { CResult } from '../../../../src/types.mts'

describe('output-manifest-setup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('outputManifestSetup', () => {
    describe('success output', () => {
      it('outputs setup complete message', async () => {
        const result: CResult<unknown> = {
          ok: true,
          data: {},
        }

        await outputManifestSetup(result)

        expect(mockLogger.success).toHaveBeenCalledWith('Setup complete')
      })

      it('does not set exit code on success', async () => {
        const result: CResult<unknown> = {
          ok: true,
          data: { configured: true },
        }

        await outputManifestSetup(result)

        expect(process.exitCode).toBeUndefined()
      })
    })

    describe('error output', () => {
      it('outputs error with fail message', async () => {
        const result: CResult<unknown> = {
          ok: false,
          message: 'Setup failed',
          cause: 'Missing configuration',
        }

        await outputManifestSetup(result)

        expect(mockLogger.fail).toHaveBeenCalledWith(
          expect.stringContaining('Setup failed'),
        )
        expect(process.exitCode).toBe(1)
      })

      it('uses custom exit code when provided', async () => {
        const result: CResult<unknown> = {
          ok: false,
          message: 'Configuration error',
          code: 2,
        }

        await outputManifestSetup(result)

        expect(process.exitCode).toBe(2)
      })

      it('does not call success on error', async () => {
        const result: CResult<unknown> = {
          ok: false,
          message: 'Failed',
        }

        await outputManifestSetup(result)

        expect(mockLogger.success).not.toHaveBeenCalled()
      })
    })
  })
})
