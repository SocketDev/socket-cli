import { beforeEach, describe, expect, it, vi } from 'vitest'

import { outputUpdateRepo } from './output-update-repo.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

// Mock the dependencies.
vi.mock('@socketsecurity/registry/lib/logger', () => ({
  logger: {
    fail: vi.fn(),
    log: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('../../utils/fail-msg-with-badge.mts', () => ({
  failMsgWithBadge: vi.fn((msg, cause) => `${msg}: ${cause}`),
}))

vi.mock('../../utils/serialize-result-json.mts', () => ({
  serializeResultJson: vi.fn(result => JSON.stringify(result)),
}))

describe('outputUpdateRepo', () => {
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

    const result: CResult<SocketSdkSuccessResult<'updateOrgRepo'>['data']> = {
      ok: true,
      data: {
        success: true,
      },
    }

    await outputUpdateRepo(result, 'test-repo', 'json')

    expect(mockSerialize).toHaveBeenCalledWith(result)
    expect(mockLog).toHaveBeenCalledWith(JSON.stringify(result))
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in JSON format', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockLog = vi.mocked(logger.log)

    const result: CResult<SocketSdkSuccessResult<'updateOrgRepo'>['data']> = {
      ok: false,
      code: 2,
      message: 'Unauthorized',
      cause: 'Invalid API token',
    }

    await outputUpdateRepo(result, 'test-repo', 'json')

    expect(mockLog).toHaveBeenCalled()
    expect(process.exitCode).toBe(2)
  })

  it('outputs success message for successful update', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockSuccess = vi.mocked(logger.success)

    const result: CResult<SocketSdkSuccessResult<'updateOrgRepo'>['data']> = {
      ok: true,
      data: {
        success: true,
      },
    }

    await outputUpdateRepo(result, 'my-repository', 'text')

    expect(mockSuccess).toHaveBeenCalledWith(
      'Repository `my-repository` updated successfully',
    )
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in text format', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const { failMsgWithBadge } = await import(
      '../../utils/fail-msg-with-badge.mts'
    )
    const mockFail = vi.mocked(logger.fail)
    const mockFailMsg = vi.mocked(failMsgWithBadge)

    const result: CResult<SocketSdkSuccessResult<'updateOrgRepo'>['data']> = {
      ok: false,
      code: 1,
      message: 'Repository not found',
      cause: 'Not found error',
    }

    await outputUpdateRepo(result, 'nonexistent-repo', 'text')

    expect(mockFailMsg).toHaveBeenCalledWith(
      'Repository not found',
      'Not found error',
    )
    expect(mockFail).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('handles markdown output format', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockSuccess = vi.mocked(logger.success)

    const result: CResult<SocketSdkSuccessResult<'updateOrgRepo'>['data']> = {
      ok: true,
      data: {
        success: true,
      },
    }

    await outputUpdateRepo(result, 'markdown-repo', 'markdown')

    expect(mockSuccess).toHaveBeenCalledWith(
      'Repository `markdown-repo` updated successfully',
    )
  })

  it('handles repository name with special characters', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockSuccess = vi.mocked(logger.success)

    const result: CResult<SocketSdkSuccessResult<'updateOrgRepo'>['data']> = {
      ok: true,
      data: {
        success: true,
      },
    }

    await outputUpdateRepo(result, 'repo-with-dashes_and_underscores', 'text')

    expect(mockSuccess).toHaveBeenCalledWith(
      'Repository `repo-with-dashes_and_underscores` updated successfully',
    )
  })

  it('handles empty repository name', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockSuccess = vi.mocked(logger.success)

    const result: CResult<SocketSdkSuccessResult<'updateOrgRepo'>['data']> = {
      ok: true,
      data: {
        success: true,
      },
    }

    await outputUpdateRepo(result, '', 'text')

    expect(mockSuccess).toHaveBeenCalledWith(
      'Repository `` updated successfully',
    )
  })

  it('sets default exit code when code is undefined', async () => {
    const result: CResult<SocketSdkSuccessResult<'updateOrgRepo'>['data']> = {
      ok: false,
      message: 'Error without code',
    }

    await outputUpdateRepo(result, 'test-repo', 'json')

    expect(process.exitCode).toBe(1)
  })
})
