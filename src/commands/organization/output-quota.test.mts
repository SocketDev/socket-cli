import { beforeEach, describe, expect, it, vi } from 'vitest'

import { outputQuota } from './output-quota.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

// Mock the dependencies.
vi.mock('@socketsecurity/registry/lib/logger', () => ({
  logger: {
    fail: vi.fn(),
    log: vi.fn(),
  },
}))

vi.mock('../../utils/fail-msg-with-badge.mts', () => ({
  failMsgWithBadge: vi.fn((msg, cause) => `${msg}: ${cause}`),
}))

vi.mock('../../utils/serialize-result-json.mts', () => ({
  serializeResultJson: vi.fn(result => JSON.stringify(result)),
}))

describe('outputQuota', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  it('outputs JSON format for successful result', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const { serializeResultJson } = await import(
      '../../utils/serialize-result-json.mts'
    )
    const mockLog = vi.mocked(logger.log)
    const mockSerialize = vi.mocked(serializeResultJson)

    const result: CResult<SocketSdkSuccessResult<'getQuota'>['data']> = {
      ok: true,
      data: {
        quota: 1000,
      },
    }

    await outputQuota(result, 'json')

    expect(mockSerialize).toHaveBeenCalledWith(result)
    expect(mockLog).toHaveBeenCalledWith(JSON.stringify(result))
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in JSON format', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockLog = vi.mocked(logger.log)

    const result: CResult<SocketSdkSuccessResult<'getQuota'>['data']> = {
      ok: false,
      code: 2,
      message: 'Unauthorized',
      cause: 'Invalid API token',
    }

    await outputQuota(result, 'json')

    expect(mockLog).toHaveBeenCalled()
    expect(process.exitCode).toBe(2)
  })

  it('outputs text format with quota information', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockLog = vi.mocked(logger.log)

    const result: CResult<SocketSdkSuccessResult<'getQuota'>['data']> = {
      ok: true,
      data: {
        quota: 500,
      },
    }

    await outputQuota(result, 'text')

    expect(mockLog).toHaveBeenCalledWith(
      'Quota left on the current API token: 500',
    )
    expect(mockLog).toHaveBeenCalledWith('')
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs markdown format with quota information', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockLog = vi.mocked(logger.log)

    const result: CResult<SocketSdkSuccessResult<'getQuota'>['data']> = {
      ok: true,
      data: {
        quota: 750,
      },
    }

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
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const { failMsgWithBadge } = await import(
      '../../utils/fail-msg-with-badge.mts'
    )
    const mockFail = vi.mocked(logger.fail)
    const mockFailMsg = vi.mocked(failMsgWithBadge)

    const result: CResult<SocketSdkSuccessResult<'getQuota'>['data']> = {
      ok: false,
      code: 1,
      message: 'Failed to fetch quota',
      cause: 'Network error',
    }

    await outputQuota(result, 'text')

    expect(mockFailMsg).toHaveBeenCalledWith(
      'Failed to fetch quota',
      'Network error',
    )
    expect(mockFail).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('handles zero quota correctly', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockLog = vi.mocked(logger.log)

    const result: CResult<SocketSdkSuccessResult<'getQuota'>['data']> = {
      ok: true,
      data: {
        quota: 0,
      },
    }

    await outputQuota(result, 'text')

    expect(mockLog).toHaveBeenCalledWith(
      'Quota left on the current API token: 0',
    )
  })

  it('uses default text output when no format specified', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockLog = vi.mocked(logger.log)

    const result: CResult<SocketSdkSuccessResult<'getQuota'>['data']> = {
      ok: true,
      data: {
        quota: 100,
      },
    }

    await outputQuota(result)

    expect(mockLog).toHaveBeenCalledWith(
      'Quota left on the current API token: 100',
    )
    expect(mockLog).toHaveBeenCalledWith('')
  })

  it('sets default exit code when code is undefined', async () => {
    const result: CResult<SocketSdkSuccessResult<'getQuota'>['data']> = {
      ok: false,
      message: 'Error without code',
    }

    await outputQuota(result, 'json')

    expect(process.exitCode).toBe(1)
  })
})
