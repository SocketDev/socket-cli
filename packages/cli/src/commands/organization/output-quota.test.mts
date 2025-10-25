import { describe, expect, it, vi } from 'vitest'

import { outputQuota } from './output-quota.mts'
import {
  createErrorResult,
  createSuccessResult,
  setupStandardOutputMocks,
  setupTestEnvironment,
} from '../../../test/helpers/index.mts'

import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

setupStandardOutputMocks()

describe('outputQuota', () => {
  setupTestEnvironment()

  it('outputs JSON format for successful result', async () => {
    const { logger } = await import('@socketsecurity/lib/logger')
    const { serializeResultJson } = await import(
      '../../utils/output/result-json.mts'
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
    const { logger } = await import('@socketsecurity/lib/logger')
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
    const { logger } = await import('@socketsecurity/lib/logger')
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
    const { logger } = await import('@socketsecurity/lib/logger')
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
    const { logger } = await import('@socketsecurity/lib/logger')
    const { failMsgWithBadge } = await import(
      '../../utils/error/fail-msg-with-badge.mts'
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
    const { logger } = await import('@socketsecurity/lib/logger')
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
    const { logger } = await import('@socketsecurity/lib/logger')
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
    const result = createErrorResult('Error without code')

    await outputQuota(result, 'json')

    expect(process.exitCode).toBe(1)
  })
})
