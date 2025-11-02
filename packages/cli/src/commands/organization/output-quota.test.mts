import { describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
  setupTestEnvironment,
} from '../../../test/helpers/index.mts'
import { outputQuota } from './output-quota.mts'

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
    const { serializeResultJson } = await vi.importMock(
      '../../utils/output/result-json.mjs',
    )

    const result = createSuccessResult<
      SocketSdkSuccessResult<'getQuota'>['data']
    >({
      quota: 1000,
    })

    await outputQuota(result, 'json')

    expect(serializeResultJson).toHaveBeenCalledWith(result)
    expect(mockLogger.log).toHaveBeenCalledWith(JSON.stringify(result))
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in JSON format', async () => {
    const result = createErrorResult('Unauthorized', {
      code: 2,
      cause: 'Invalid API token',
    })

    await outputQuota(result, 'json')

    expect(mockLogger.log).toHaveBeenCalled()
    expect(process.exitCode).toBe(2)
  })

  it('outputs text format with quota information', async () => {
    const result = createSuccessResult<
      SocketSdkSuccessResult<'getQuota'>['data']
    >({
      quota: 500,
    })

    await outputQuota(result, 'text')

    expect(mockLogger.log).toHaveBeenCalledWith(
      'Quota left on the current API token: 500',
    )
    expect(mockLogger.log).toHaveBeenCalledWith('')
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs markdown format with quota information', async () => {
    const result = createSuccessResult<
      SocketSdkSuccessResult<'getQuota'>['data']
    >({
      quota: 750,
    })

    await outputQuota(result, 'markdown')

    expect(mockLogger.log).toHaveBeenCalledWith('# Quota')
    expect(mockLogger.log).toHaveBeenCalledWith('')
    expect(mockLogger.log).toHaveBeenCalledWith(
      'Quota left on the current API token: 750',
    )
    expect(mockLogger.log).toHaveBeenCalledWith('')
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in text format', async () => {
    const { failMsgWithBadge } = await vi.importMock(
      '../../utils/error/fail-msg-with-badge.mts',
    )

    const result = createErrorResult('Failed to fetch quota', {
      cause: 'Network error',
    })

    await outputQuota(result, 'text')

    expect(failMsgWithBadge).toHaveBeenCalledWith(
      'Failed to fetch quota',
      'Network error',
    )
    expect(mockLogger.fail).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('handles zero quota correctly', async () => {
    const result = createSuccessResult<
      SocketSdkSuccessResult<'getQuota'>['data']
    >({
      quota: 0,
    })

    await outputQuota(result, 'text')

    expect(mockLogger.log).toHaveBeenCalledWith(
      'Quota left on the current API token: 0',
    )
  })

  it('uses default text output when no format specified', async () => {
    const result = createSuccessResult<
      SocketSdkSuccessResult<'getQuota'>['data']
    >({
      quota: 100,
    })

    await outputQuota(result)

    expect(mockLogger.log).toHaveBeenCalledWith(
      'Quota left on the current API token: 100',
    )
    expect(mockLogger.log).toHaveBeenCalledWith('')
  })

  it('sets default exit code when code is undefined', async () => {
    const result = createErrorResult('Error without code')

    await outputQuota(result, 'json')

    expect(process.exitCode).toBe(1)
  })
})
