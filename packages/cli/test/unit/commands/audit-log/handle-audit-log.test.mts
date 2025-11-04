import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../helpers/mocks.mts'
import { handleAuditLog } from '../../../../src/commands/audit-log/handle-audit-log.mts'

// Mock the dependencies.
const mockFetchAuditLog = vi.hoisted(() => vi.fn())
const mockOutputAuditLog = vi.hoisted(() => vi.fn())
const mockGetDefaultLogger = vi.hoisted(() => vi.fn())
const mockLog = vi.hoisted(() => vi.fn())
const mockInfo = vi.hoisted(() => vi.fn())
const mockWarn = vi.hoisted(() => vi.fn())
const mockError = vi.hoisted(() => vi.fn())
const mockFail = vi.hoisted(() => vi.fn())
const mockSuccess = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/commands/audit-log/fetch-audit-log.mts', () => ({
  fetchAuditLog: mockFetchAuditLog,
}))
vi.mock('../../../../src/commands/audit-log/output-audit-log.mts', () => ({
  outputAuditLog: mockOutputAuditLog,
}))
vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: mockGetDefaultLogger,
}))

describe('handleAuditLog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches and outputs audit logs', async () => {
    const { fetchAuditLog } = await import('../../../../src/commands/audit-log/fetch-audit-log.mts')
    const { outputAuditLog } = await import('../../../../src/commands/audit-log/output-audit-log.mts')

    const mockLogs = createSuccessResult([
      { id: 1, type: 'security', message: 'Security event' },
      { id: 2, type: 'access', message: 'Access event' },
    ])
    mockFetchAuditLog.mockResolvedValue(mockLogs)

    await handleAuditLog({
      logType: 'security',
      orgSlug: 'test-org',
      outputKind: 'json',
      page: 1,
      perPage: 10,
    })

    expect(fetchAuditLog).toHaveBeenCalledWith({
      logType: 'security',
      orgSlug: 'test-org',
      outputKind: 'json',
      page: 1,
      perPage: 10,
    })
    expect(outputAuditLog).toHaveBeenCalledWith(mockLogs, {
      logType: 'security',
      orgSlug: 'test-org',
      outputKind: 'json',
      page: 1,
      perPage: 10,
    })
  })

  it('handles pagination', async () => {
    const { fetchAuditLog } = await import('../../../../src/commands/audit-log/fetch-audit-log.mts')
    const { outputAuditLog } = await import('../../../../src/commands/audit-log/output-audit-log.mts')

    const mockLogs = createSuccessResult([])
    mockFetchAuditLog.mockResolvedValue(mockLogs)

    await handleAuditLog({
      logType: 'all',
      orgSlug: 'test-org',
      outputKind: 'text',
      page: 5,
      perPage: 50,
    })

    expect(fetchAuditLog).toHaveBeenCalledWith({
      logType: 'all',
      orgSlug: 'test-org',
      outputKind: 'text',
      page: 5,
      perPage: 50,
    })
    expect(outputAuditLog).toHaveBeenCalledWith(mockLogs, {
      logType: 'all',
      orgSlug: 'test-org',
      outputKind: 'text',
      page: 5,
      perPage: 50,
    })
  })

  it('handles markdown output', async () => {
    const { fetchAuditLog } = await import('../../../../src/commands/audit-log/fetch-audit-log.mts')
    const { outputAuditLog } = await import('../../../../src/commands/audit-log/output-audit-log.mts')

    const mockLogs = createSuccessResult([
      { id: 1, type: 'config', message: 'Config change' },
    ])
    mockFetchAuditLog.mockResolvedValue(mockLogs)

    await handleAuditLog({
      logType: 'config',
      orgSlug: 'my-org',
      outputKind: 'markdown',
      page: 1,
      perPage: 20,
    })

    expect(fetchAuditLog).toHaveBeenCalledWith({
      logType: 'config',
      orgSlug: 'my-org',
      outputKind: 'markdown',
      page: 1,
      perPage: 20,
    })
    expect(outputAuditLog).toHaveBeenCalledWith(mockLogs, {
      logType: 'config',
      orgSlug: 'my-org',
      outputKind: 'markdown',
      page: 1,
      perPage: 20,
    })
  })

  it('handles empty audit logs', async () => {
    const { fetchAuditLog } = await import('../../../../src/commands/audit-log/fetch-audit-log.mts')
    const { outputAuditLog } = await import('../../../../src/commands/audit-log/output-audit-log.mts')

    const mockLogs = createSuccessResult([])
    mockFetchAuditLog.mockResolvedValue(mockLogs)

    await handleAuditLog({
      logType: 'access',
      orgSlug: 'test-org',
      outputKind: 'json',
      page: 1,
      perPage: 10,
    })

    expect(outputAuditLog).toHaveBeenCalledWith(mockLogs, expect.any(Object))
  })

  it('handles fetch errors', async () => {
    const { fetchAuditLog } = await import('../../../../src/commands/audit-log/fetch-audit-log.mts')
    const { outputAuditLog } = await import('../../../../src/commands/audit-log/output-audit-log.mts')

    const mockError = createErrorResult('API error')
    mockFetchAuditLog.mockResolvedValue(mockError)

    await handleAuditLog({
      logType: 'security',
      orgSlug: 'test-org',
      outputKind: 'json',
      page: 1,
      perPage: 10,
    })

    expect(outputAuditLog).toHaveBeenCalledWith(mockError, expect.any(Object))
  })

  it('handles different log types', async () => {
    const { fetchAuditLog } = await import('../../../../src/commands/audit-log/fetch-audit-log.mts')

    const logTypes = ['all', 'security', 'access', 'config', 'data']

    for (const logType of logTypes) {
      mockFetchAuditLog.mockResolvedValue(createSuccessResult([]))

      // eslint-disable-next-line no-await-in-loop
      await handleAuditLog({
        logType,
        orgSlug: 'test-org',
        outputKind: 'json',
        page: 1,
        perPage: 10,
      })

      expect(fetchAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ logType }),
      )
    }
  })
})
