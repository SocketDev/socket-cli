/**
 * Unit tests for config get output formatting.
 *
 * Purpose:
 * Tests the output formatting for config get results.
 *
 * Test Coverage:
 * - outputConfigGet function
 * - JSON output format
 * - Text output format
 * - Markdown output format
 * - Error handling
 *
 * Related Files:
 * - src/commands/config/output-config-get.mts (implementation)
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
const mockIsConfigFromFlag = vi.hoisted(() => vi.fn(() => false))
vi.mock('../../../../src/utils/config.mts', () => ({
  isConfigFromFlag: mockIsConfigFromFlag,
}))

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

import { outputConfigGet } from '../../../../src/commands/config/output-config-get.mts'

import type { CResult } from '../../../../src/types.mts'

describe('output-config-get', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    mockIsConfigFromFlag.mockReturnValue(false)
  })

  describe('outputConfigGet', () => {
    describe('JSON output', () => {
      it('outputs success result as JSON', async () => {
        const result: CResult<string> = {
          ok: true,
          data: 'my-org',
        }

        await outputConfigGet('defaultOrg', result, 'json')

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('"ok": true'),
        )
      })

      it('outputs error result as JSON', async () => {
        const result: CResult<string> = {
          ok: false,
          message: 'Config not found',
        }

        await outputConfigGet('defaultOrg', result, 'json')

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('"ok": false'),
        )
        expect(process.exitCode).toBe(1)
      })

      it('uses custom exit code when provided', async () => {
        const result: CResult<string> = {
          ok: false,
          message: 'Failed',
          code: 2,
        }

        await outputConfigGet('defaultOrg', result, 'json')

        expect(process.exitCode).toBe(2)
      })
    })

    describe('Text output', () => {
      it('outputs config value', async () => {
        const result: CResult<string> = {
          ok: true,
          data: 'my-org',
        }

        await outputConfigGet('defaultOrg', result, 'text')

        expect(mockLogger.log).toHaveBeenCalledWith('defaultOrg: my-org')
      })

      it('outputs error with fail message', async () => {
        const result: CResult<string> = {
          ok: false,
          message: 'Key not found',
          cause: 'Invalid key',
        }

        await outputConfigGet('defaultOrg', result, 'text')

        expect(mockLogger.fail).toHaveBeenCalledWith(
          expect.stringContaining('Key not found'),
        )
        expect(process.exitCode).toBe(1)
      })

      it('shows read-only note when config from flag', async () => {
        mockIsConfigFromFlag.mockReturnValue(true)
        const result: CResult<string> = {
          ok: true,
          data: 'test-value',
        }

        await outputConfigGet('defaultOrg', result, 'text')

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('read-only')
      })
    })

    describe('Markdown output', () => {
      it('outputs config value as markdown', async () => {
        const result: CResult<string> = {
          ok: true,
          data: 'my-org',
        }

        await outputConfigGet('defaultOrg', result, 'markdown')

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('# Config Value')
        expect(logs).toContain('defaultOrg')
        expect(logs).toContain('my-org')
      })

      it('shows read-only note in markdown when config from flag', async () => {
        mockIsConfigFromFlag.mockReturnValue(true)
        const result: CResult<string> = {
          ok: true,
          data: 'test-value',
        }

        await outputConfigGet('defaultOrg', result, 'markdown')

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('read-only')
      })
    })
  })
})
