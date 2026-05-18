/**
 * Unit tests for the outputAuditLog dispatcher.
 *
 * The format helpers (outputAsJson / outputAsMarkdown) have their own snapshot
 * tests; this suite covers the outer outputAuditLog() entry point: error path,
 * JSON / markdown / text mode dispatch, exit code.
 *
 * Related Files: - src/commands/audit-log/output-audit-log.mts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLogger = vi.hoisted(() => ({
  log: vi.fn(),
  fail: vi.fn(),
}))
const mockDisplayAuditLogWithIocraft = vi.hoisted(() => vi.fn())

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))
vi.mock('../../../../src/commands/audit-log/AuditLogRenderer.mts', () => ({
  displayAuditLogWithIocraft: mockDisplayAuditLogWithIocraft,
}))

import { outputAuditLog } from '../../../../src/commands/audit-log/output-audit-log.mts'

const sampleData = {
  results: [
    {
      event_id: '1',
      created_at: '2025-04-19T00:00:00Z',
      type: 'login',
      user_email: 'a@b.c',
      ip_address: '1.2.3.4',
      user_agent: 'agent',
    },
  ],
  nextPage: '2',
} as unknown

const baseOpts = {
  logType: '',
  orgSlug: 'org',
  page: 1,
  perPage: 10,
}

describe('outputAuditLog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  it('sets exit code from result.code on failure', async () => {
    await outputAuditLog(
      { ok: false, message: 'failed', code: 7 },
      { outputKind: 'text', ...baseOpts },
    )

    expect(process.exitCode).toBe(7)
  })

  it('defaults exit code to 1 when result.code is missing', async () => {
    await outputAuditLog(
      { ok: false, message: 'failed' },
      { outputKind: 'text', ...baseOpts },
    )

    expect(process.exitCode).toBe(1)
  })

  it('logs JSON for successful result in JSON mode', async () => {
    await outputAuditLog(
      { ok: true, data: sampleData },
      { outputKind: 'json', ...baseOpts },
    )

    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.stringContaining('Audit logs for given query'),
    )
  })

  it('logs JSON for failed result in JSON mode and then fails', async () => {
    await outputAuditLog(
      { ok: false, message: 'failed' },
      { outputKind: 'json', ...baseOpts },
    )

    expect(mockLogger.log).toHaveBeenCalled()
    expect(mockLogger.fail).toHaveBeenCalled()
  })

  it('logs failure with badge in non-JSON mode for failed result', async () => {
    await outputAuditLog(
      { ok: false, message: 'failed', cause: 'detail' },
      { outputKind: 'text', ...baseOpts },
    )

    expect(mockLogger.fail).toHaveBeenCalled()
    expect(mockDisplayAuditLogWithIocraft).not.toHaveBeenCalled()
  })

  it('logs markdown for successful result in markdown mode', async () => {
    await outputAuditLog(
      { ok: true, data: sampleData },
      { outputKind: 'markdown', ...baseOpts },
    )

    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.stringContaining('# Socket Audit Logs'),
    )
    expect(mockDisplayAuditLogWithIocraft).not.toHaveBeenCalled()
  })

  it('renders with iocraft for text mode on success', async () => {
    await outputAuditLog(
      { ok: true, data: sampleData },
      { outputKind: 'text', ...baseOpts },
    )

    expect(mockDisplayAuditLogWithIocraft).toHaveBeenCalledWith(
      expect.objectContaining({ orgSlug: 'org' }),
    )
  })
})
