/**
 * Unit tests for config list output formatting.
 *
 * Purpose:
 * Tests the output formatting for config list results.
 *
 * Test Coverage:
 * - outputConfigList function
 * - JSON output format with full/partial modes
 * - Text output format
 * - Sensitive key masking
 * - Read-only mode indicators
 *
 * Related Files:
 * - src/commands/config/output-config-list.mts (implementation)
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

// Mock config utilities.
const mockGetConfigValue = vi.hoisted(() =>
  vi.fn(() => ({ ok: true, data: 'test-value' })),
)
const mockGetSupportedConfigKeys = vi.hoisted(() =>
  vi.fn(() => ['apiToken', 'defaultOrg', 'enforcedOrgs']),
)
const mockIsConfigFromFlag = vi.hoisted(() => vi.fn(() => false))
const mockIsSensitiveConfigKey = vi.hoisted(() =>
  vi.fn((key: string) => key === 'apiToken'),
)

vi.mock('../../../../src/utils/config.mts', () => ({
  getConfigValue: mockGetConfigValue,
  getSupportedConfigKeys: mockGetSupportedConfigKeys,
  isConfigFromFlag: mockIsConfigFromFlag,
  isSensitiveConfigKey: mockIsSensitiveConfigKey,
}))

vi.mock('../../../../src/utils/output/markdown.mts', () => ({
  mdHeader: (text: string) => `# ${text}`,
}))

vi.mock('../../../../src/utils/output/result-json.mjs', () => ({
  serializeResultJson: (result: unknown) => JSON.stringify(result, null, 2),
}))

import { outputConfigList } from '../../../../src/commands/config/output-config-list.mts'

describe('output-config-list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    mockIsConfigFromFlag.mockReturnValue(false)
    mockGetConfigValue.mockReturnValue({ ok: true, data: 'test-value' })
  })

  describe('outputConfigList', () => {
    describe('JSON output', () => {
      it('outputs all config keys as JSON', async () => {
        mockGetConfigValue
          .mockReturnValueOnce({ ok: true, data: 'sk_live_xxx' })
          .mockReturnValueOnce({ ok: true, data: 'my-org' })
          .mockReturnValueOnce({ ok: true, data: undefined })

        await outputConfigList({ full: true, outputKind: 'json' })

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('"ok": true'),
        )
      })

      it('masks sensitive keys when full is false', async () => {
        mockGetConfigValue
          .mockReturnValueOnce({ ok: true, data: 'sk_live_xxx' })
          .mockReturnValueOnce({ ok: true, data: 'my-org' })
          .mockReturnValueOnce({ ok: true, data: undefined })

        await outputConfigList({ full: false, outputKind: 'json' })

        const loggedJson = mockLogger.log.mock.calls[0]![0]
        expect(loggedJson).toContain('********')
      })

      it('sets exit code on config retrieval failure', async () => {
        mockGetConfigValue.mockReturnValue({
          ok: false,
          message: 'Failed to read',
        })

        await outputConfigList({ full: true, outputKind: 'json' })

        expect(process.exitCode).toBe(1)
      })

      it('includes readOnly status in output', async () => {
        mockIsConfigFromFlag.mockReturnValue(true)
        mockGetConfigValue.mockReturnValue({ ok: true, data: 'value' })

        await outputConfigList({ full: true, outputKind: 'json' })

        const loggedJson = mockLogger.log.mock.calls[0]![0]
        expect(loggedJson).toContain('"readOnly": true')
      })
    })

    describe('Text output', () => {
      it('outputs config header and values', async () => {
        mockGetConfigValue
          .mockReturnValueOnce({ ok: true, data: 'sk_live_xxx' })
          .mockReturnValueOnce({ ok: true, data: 'my-org' })
          .mockReturnValueOnce({ ok: true, data: undefined })

        await outputConfigList({ full: true, outputKind: 'text' })

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('# Local CLI Config')
        expect(logs).toContain('my-org')
      })

      it('masks sensitive keys in text output when full is false', async () => {
        mockGetConfigValue
          .mockReturnValueOnce({ ok: true, data: 'sk_live_xxx' })
          .mockReturnValueOnce({ ok: true, data: 'my-org' })
          .mockReturnValueOnce({ ok: true, data: undefined })

        await outputConfigList({ full: false, outputKind: 'text' })

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('********')
      })

      it('shows read-only note when config from flag', async () => {
        mockIsConfigFromFlag.mockReturnValue(true)
        mockGetConfigValue.mockReturnValue({ ok: true, data: 'test' })

        await outputConfigList({ full: false, outputKind: 'text' })

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('read-only')
      })

      it('shows failed to read message on error', async () => {
        mockGetConfigValue.mockReturnValue({
          ok: false,
          message: 'Permission denied',
        })

        await outputConfigList({ full: true, outputKind: 'text' })

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('failed to read')
        expect(logs).toContain('Permission denied')
      })

      it('shows <none> for undefined values in full mode', async () => {
        mockGetConfigValue.mockReturnValue({ ok: true, data: undefined })

        await outputConfigList({ full: true, outputKind: 'text' })

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('<none>')
      })

      it('handles array values', async () => {
        mockGetConfigValue
          .mockReturnValueOnce({ ok: true, data: 'token' })
          .mockReturnValueOnce({ ok: true, data: 'my-org' })
          .mockReturnValueOnce({ ok: true, data: ['org1', 'org2'] })

        await outputConfigList({ full: true, outputKind: 'text' })

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('org1, org2')
      })
    })
  })
})
