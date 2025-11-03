import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../../src/helpers/mocks.mts'
import { handleAuditLog } from '../../../../src/src/handle-audit-log.mts'

// Mock the dependencies.
vi.mock('./fetch-audit-log.mts', () => ({
  fetchAuditLog: vi.fn(),
}))
vi.mock('./output-audit-log.mts', () => ({
  outputAuditLog: vi.fn(),
}))

describe('handleAuditLog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches and outputs audit logs', async () => {
    const { fetchAuditLog } = await import('../../src/fetch-audit-log.mts')
    const { outputAuditLog } = await import('../../src/output-audit-log.mts')

    const mockLogs = createSuccessResult([
      { id: 1, type: 'security', message: 'Security event' },
      { id: 2, type: 'access', message: 'Access event' },
    ])
    vi.mocked(fetchAuditLog).mockResolvedValue(mockLogs)

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
    const { fetchAuditLog } = await import('../../src/fetch-audit-log.mts')
    const { outputAuditLog } = await import('../../src/output-audit-log.mts')

    const mockLogs = createSuccessResult([])
    vi.mocked(fetchAuditLog).mockResolvedValue(mockLogs)

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
    const { fetchAuditLog } = await import('../../src/fetch-audit-log.mts')
    const { outputAuditLog } = await import('../../src/output-audit-log.mts')

    const mockLogs = createSuccessResult([
      { id: 1, type: 'config', message: 'Config change' },
    ])
    vi.mocked(fetchAuditLog).mockResolvedValue(mockLogs)

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
    const { fetchAuditLog } = await import('../../src/fetch-audit-log.mts')
    const { outputAuditLog } = await import('../../src/output-audit-log.mts')

    const mockLogs = createSuccessResult([])
    vi.mocked(fetchAuditLog).mockResolvedValue(mockLogs)

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
    const { fetchAuditLog } = await import('../../src/fetch-audit-log.mts')
    const { outputAuditLog } = await import('../../src/output-audit-log.mts')

    const mockError = createErrorResult('API error')
    vi.mocked(fetchAuditLog).mockResolvedValue(mockError)

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
    const { fetchAuditLog } = await import('../../src/fetch-audit-log.mts')

    const logTypes = ['all', 'security', 'access', 'config', 'data']

    for (const logType of logTypes) {
      vi.mocked(fetchAuditLog).mockResolvedValue(createSuccessResult([]))

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
