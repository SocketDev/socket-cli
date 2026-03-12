/**
 * Unit tests for config auto output formatting.
 *
 * Purpose:
 * Tests the output formatting for config auto-discovery results.
 *
 * Test Coverage:
 * - outputConfigAuto function
 * - JSON output format
 * - Text output format
 * - Markdown output format
 * - Interactive prompts for defaultOrg
 * - Read-only mode handling
 *
 * Related Files:
 * - src/commands/config/output-config-auto.mts (implementation)
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

// Mock prompts.
const mockSelect = vi.hoisted(() => vi.fn())
vi.mock('@socketsecurity/lib/stdio/prompts', () => ({
  select: mockSelect,
}))

// Mock config utilities.
const mockIsConfigFromFlag = vi.hoisted(() => vi.fn(() => false))
const mockUpdateConfigValue = vi.hoisted(() =>
  vi.fn(() => ({ ok: true, message: 'Updated' })),
)

vi.mock('../../../../src/utils/config.mts', () => ({
  isConfigFromFlag: mockIsConfigFromFlag,
  updateConfigValue: mockUpdateConfigValue,
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

import { outputConfigAuto } from '../../../../src/commands/config/output-config-auto.mts'

import type { CResult } from '../../../../src/types.mts'

describe('output-config-auto', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    mockIsConfigFromFlag.mockReturnValue(false)
    mockUpdateConfigValue.mockReturnValue({ ok: true, message: 'Updated' })
  })

  describe('outputConfigAuto', () => {
    describe('JSON output', () => {
      it('outputs success result as JSON', async () => {
        const result: CResult<string> = {
          ok: true,
          data: 'my-org',
        }

        await outputConfigAuto('defaultOrg', result, 'json')

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('"ok": true'),
        )
      })

      it('outputs error result as JSON', async () => {
        const result: CResult<string> = {
          ok: false,
          message: 'Auto-discovery failed',
        }

        await outputConfigAuto('defaultOrg', result, 'json')

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('"ok": false'),
        )
        expect(process.exitCode).toBe(1)
      })

      it('uses custom exit code when provided', async () => {
        const result: CResult<string> = {
          ok: false,
          message: 'Failed',
          code: 5,
        }

        await outputConfigAuto('defaultOrg', result, 'json')

        expect(process.exitCode).toBe(5)
      })
    })

    describe('Markdown output', () => {
      it('outputs auto-discovery header and value', async () => {
        const result: CResult<string> = {
          ok: true,
          data: 'discovered-org',
        }

        await outputConfigAuto('defaultOrg', result, 'markdown')

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('# Auto discover config value')
        expect(logs).toContain('defaultOrg')
        expect(logs).toContain('discovered-org')
      })

      it('includes message when provided', async () => {
        const result: CResult<string> = {
          ok: true,
          data: 'my-org',
          message: 'Found via GitHub API',
        }

        await outputConfigAuto('defaultOrg', result, 'markdown')

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('Found via GitHub API')
      })
    })

    describe('Text output', () => {
      it('outputs discovered value', async () => {
        // Mock select to return empty (No)
        mockSelect.mockResolvedValue('')

        const result: CResult<string> = {
          ok: true,
          data: 'auto-org',
        }

        await outputConfigAuto('defaultOrg', result, 'text')

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('defaultOrg: auto-org')
      })

      it('shows read-only message when config from flag', async () => {
        mockIsConfigFromFlag.mockReturnValue(true)
        const result: CResult<string> = {
          ok: true,
          data: 'test-org',
        }

        await outputConfigAuto('defaultOrg', result, 'text')

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('read-only')
      })

      it('updates config when user confirms for defaultOrg', async () => {
        mockSelect.mockResolvedValue('my-org')

        const result: CResult<string> = {
          ok: true,
          data: 'my-org',
        }

        await outputConfigAuto('defaultOrg', result, 'text')

        expect(mockUpdateConfigValue).toHaveBeenCalledWith(
          'defaultOrg',
          'my-org',
        )
        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('Updated defaultOrg')
      })

      it('shows no changes message when user declines', async () => {
        mockSelect.mockResolvedValue('')

        const result: CResult<string> = {
          ok: true,
          data: 'my-org',
        }

        await outputConfigAuto('defaultOrg', result, 'text')

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('No changes made')
      })

      it('handles update failure', async () => {
        mockSelect.mockResolvedValue('my-org')
        mockUpdateConfigValue.mockReturnValue({
          ok: false,
          message: 'Write failed',
          cause: 'Permission denied',
        })

        const result: CResult<string> = {
          ok: true,
          data: 'my-org',
        }

        await outputConfigAuto('defaultOrg', result, 'text')

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('Write failed')
      })

      it('outputs error with fail message', async () => {
        const result: CResult<string> = {
          ok: false,
          message: 'Could not auto-discover',
          cause: 'No orgs found',
        }

        await outputConfigAuto('defaultOrg', result, 'text')

        expect(mockLogger.fail).toHaveBeenCalledWith(
          expect.stringContaining('Could not auto-discover'),
        )
      })

      it('handles enforcedOrgs key with prompt', async () => {
        mockSelect.mockResolvedValue('enforced-org')

        const result: CResult<string> = {
          ok: true,
          data: 'enforced-org',
        }

        await outputConfigAuto('enforcedOrgs', result, 'text')

        // Select should be called for enforcedOrgs.
        expect(mockSelect).toHaveBeenCalled()
      })
    })
  })
})
