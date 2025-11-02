import { describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
  setupTestEnvironment,
} from '../../../test/helpers/index.mts'

import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

// Mock the dependencies.
const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  log: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

vi.mock('../../utils/output/result-json.mjs', () => ({
  serializeResultJson: vi.fn(result => JSON.stringify(result)),
}))

vi.mock('../../utils/error/fail-msg-with-badge.mts', () => ({
  failMsgWithBadge: vi.fn((msg, cause) => `${msg}: ${cause}`),
}))

describe('outputQuota', () => {
  setupTestEnvironment()

  it('outputs JSON format for successful result', async () => {
    const { outputQuota } = await import('./output-quota.mts')
    const { logger } = await vi.importMock('@socketsecurity/lib/logger')
    const { serializeResultJson } = await vi.importMock(
      '../../utils/output/result-json.mjs',
    )
    const mockLog = vi.mocked(logger.log)
    const mockSerialize = vi.mocked(serializeResultJson)

    const result = createSuccessResult<
      SocketSdkSuccessResult<'getQuota'>['data']
    >({
      quota: 1000,
    })

    await outputQuota(result, 'json')

    expect(mockSerialize).toHaveBeenCalledWith(result)
    expect(mockLog).toHaveBeenCalledWith(JSON.stringify(result))
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in JSON format', async () => {
    const { outputQuota } = await import('./output-quota.mts')
    const { logger } = await vi.importMock('@socketsecurity/lib/logger')
    const mockLog = vi.mocked(logger.log)

    const result = createErrorResult('Unauthorized', {
      code: 2,
      cause: 'Invalid API token',
    })

    await outputQuota(result, 'json')

    expect(mockLog).toHaveBeenCalled()
    expect(process.exitCode).toBe(2)
  })

  it('outputs text format with quota information', async () => {
    const { outputQuota } = await import('./output-quota.mts')
    const { logger } = await vi.importMock('@socketsecurity/lib/logger')
    const mockLog = vi.mocked(logger.log)

    const result = createSuccessResult<
      SocketSdkSuccessResult<'getQuota'>['data']
    >({
      quota: 500,
    })

    await outputQuota(result, 'text')

    expect(mockLog).toHaveBeenCalledWith(
      'Quota left on the current API token: 500',
    )
    expect(mockLog).toHaveBeenCalledWith('')
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs markdown format with quota information', async () => {
    const { outputQuota } = await import('./output-quota.mts')
    const { logger } = await vi.importMock('@socketsecurity/lib/logger')
    const mockLog = vi.mocked(logger.log)

    const result = createSuccessResult<
      SocketSdkSuccessResult<'getQuota'>['data']
    >({
      quota: 750,
    })

    await outputQuota(result, 'markdown')

    expect(mockLog).toHaveBeenCalledWith('# Quota')
    expect(mockLog).toHaveBeenCalledWith('')
    expect(mockLog).toHaveBeenCalledWith(
      'Quota left on the current API token: 750',
    )
    expect(mockLog).toHaveBeenCalledWith('')
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in text format', async () => {
    const { outputQuota } = await import('./output-quota.mts')
    const { logger } = await vi.importMock('@socketsecurity/lib/logger')
    const { failMsgWithBadge } = await vi.importMock(
      '../../utils/error/fail-msg-with-badge.mts',
    )
    const mockFail = vi.mocked(logger.fail)
    const mockFailMsg = vi.mocked(failMsgWithBadge)

    const result = createErrorResult('Failed to fetch quota', {
      cause: 'Network error',
    })

    await outputQuota(result, 'text')

    expect(mockFailMsg).toHaveBeenCalledWith(
      'Failed to fetch quota',
      'Network error',
    )
    expect(mockFail).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('handles zero quota correctly', async () => {
    const { outputQuota } = await import('./output-quota.mts')
    const { logger } = await vi.importMock('@socketsecurity/lib/logger')
    const mockLog = vi.mocked(logger.log)

    const result = createSuccessResult<
      SocketSdkSuccessResult<'getQuota'>['data']
    >({
      quota: 0,
    })

    await outputQuota(result, 'text')

    expect(mockLog).toHaveBeenCalledWith(
      'Quota left on the current API token: 0',
    )
  })

  it('uses default text output when no format specified', async () => {
    const { outputQuota } = await import('./output-quota.mts')
    const { logger } = await vi.importMock('@socketsecurity/lib/logger')
    const mockLog = vi.mocked(logger.log)

    const result = createSuccessResult<
      SocketSdkSuccessResult<'getQuota'>['data']
    >({
      quota: 100,
    })

    await outputQuota(result)

    expect(mockLog).toHaveBeenCalledWith(
      'Quota left on the current API token: 100',
    )
    expect(mockLog).toHaveBeenCalledWith('')
  })

  it('sets default exit code when code is undefined', async () => {
    const { outputQuota } = await import('./output-quota.mts')
    const result = createErrorResult('Error without code')

    await outputQuota(result, 'json')

    expect(process.exitCode).toBe(1)
  })
})
