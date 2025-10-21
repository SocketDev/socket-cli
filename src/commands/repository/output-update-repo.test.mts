import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createErrorResult,
  createSuccessResult,
  setupStandardOutputMocks,
} from '../../../test/helpers/index.mts'

import type { CResult } from '../../types.mts'
import { outputUpdateRepo } from './output-update-repo.mts'

// Mock the dependencies.
setupStandardOutputMocks()

describe('outputUpdateRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  it('outputs JSON format for successful result', async () => {
    const { logger } = await import('@socketsecurity/lib/logger')
    const { serializeResultJson } = await import(
      '../../utils/serialize/result-json.mts'
    )
    const mockLog = vi.mocked(logger.log)
    const mockSerialize = vi.mocked(serializeResultJson)

    const result: CResult<SocketSdkSuccessResult<'updateOrgRepo'>['data']> =
      createSuccessResult({
        success: true,
      })

    await outputUpdateRepo(result, 'test-repo', 'json')

    expect(mockSerialize).toHaveBeenCalledWith(result)
    expect(mockLog).toHaveBeenCalledWith(JSON.stringify(result))
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in JSON format', async () => {
    const { logger } = await import('@socketsecurity/lib/logger')
    const mockLog = vi.mocked(logger.log)

    const result: CResult<SocketSdkSuccessResult<'updateOrgRepo'>['data']> =
      createErrorResult('Unauthorized', {
        cause: 'Invalid API token',
        code: 2,
      })

    await outputUpdateRepo(result, 'test-repo', 'json')

    expect(mockLog).toHaveBeenCalled()
    expect(process.exitCode).toBe(2)
  })

  it('outputs success message for successful update', async () => {
    const { logger } = await import('@socketsecurity/lib/logger')
    const mockSuccess = vi.mocked(logger.success)

    const result: CResult<SocketSdkSuccessResult<'updateOrgRepo'>['data']> =
      createSuccessResult({
        success: true,
      })

    await outputUpdateRepo(result, 'my-repository', 'text')

    expect(mockSuccess).toHaveBeenCalledWith(
      'Repository `my-repository` updated successfully',
    )
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in text format', async () => {
    const { logger } = await import('@socketsecurity/lib/logger')
    const { failMsgWithBadge } = await import(
      '../../utils/error/fail-msg-with-badge.mts'
    )
    const mockFail = vi.mocked(logger.fail)
    const mockFailMsg = vi.mocked(failMsgWithBadge)

    const result: CResult<SocketSdkSuccessResult<'updateOrgRepo'>['data']> =
      createErrorResult('Repository not found', {
        cause: 'Not found error',
        code: 1,
      })

    await outputUpdateRepo(result, 'nonexistent-repo', 'text')

    expect(mockFailMsg).toHaveBeenCalledWith(
      'Repository not found',
      'Not found error',
    )
    expect(mockFail).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('handles markdown output format', async () => {
    const { logger } = await import('@socketsecurity/lib/logger')
    const mockSuccess = vi.mocked(logger.success)

    const result: CResult<SocketSdkSuccessResult<'updateOrgRepo'>['data']> =
      createSuccessResult({
        success: true,
      })

    await outputUpdateRepo(result, 'markdown-repo', 'markdown')

    expect(mockSuccess).toHaveBeenCalledWith(
      'Repository `markdown-repo` updated successfully',
    )
  })

  it('handles repository name with special characters', async () => {
    const { logger } = await import('@socketsecurity/lib/logger')
    const mockSuccess = vi.mocked(logger.success)

    const result: CResult<SocketSdkSuccessResult<'updateOrgRepo'>['data']> =
      createSuccessResult({
        success: true,
      })

    await outputUpdateRepo(result, 'repo-with-dashes_and_underscores', 'text')

    expect(mockSuccess).toHaveBeenCalledWith(
      'Repository `repo-with-dashes_and_underscores` updated successfully',
    )
  })

  it('handles empty repository name', async () => {
    const { logger } = await import('@socketsecurity/lib/logger')
    const mockSuccess = vi.mocked(logger.success)

    const result: CResult<SocketSdkSuccessResult<'updateOrgRepo'>['data']> =
      createSuccessResult({
        success: true,
      })

    await outputUpdateRepo(result, '', 'text')

    expect(mockSuccess).toHaveBeenCalledWith(
      'Repository `` updated successfully',
    )
  })

  it('sets default exit code when code is undefined', async () => {
    const result: CResult<SocketSdkSuccessResult<'updateOrgRepo'>['data']> =
      createErrorResult('Error without code')

    await outputUpdateRepo(result, 'test-repo', 'json')

    expect(process.exitCode).toBe(1)
  })
})
