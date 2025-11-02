import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../test/helpers/index.mts'
import { outputUpdateRepo } from './output-update-repo.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'
import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'

import type { CResult } from '../../types.mts'
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

// Helper references to mockLogger methods.
const mockLog = mockLogger.log
const mockFail = mockLogger.fail
const mockSuccess = mockLogger.success

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

describe('outputUpdateRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  it('outputs JSON format for successful result', async () => {
    const mockSerialize = vi.mocked(serializeResultJson)

    const result: CResult<SocketSdkSuccessResult<'updateRepository'>['data']> =
      createSuccessResult({
        success: true,
      })

    await outputUpdateRepo(result, 'test-repo', 'json')

    expect(mockSerialize).toHaveBeenCalledWith(result)
    expect(mockLogger.log).toHaveBeenCalledWith(JSON.stringify(result))
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in JSON format', async () => {
    const result: CResult<SocketSdkSuccessResult<'updateRepository'>['data']> =
      createErrorResult('Unauthorized', {
        cause: 'Invalid API token',
        code: 2,
      })

    await outputUpdateRepo(result, 'test-repo', 'json')

    expect(mockLogger.log).toHaveBeenCalled()
    expect(process.exitCode).toBe(2)
  })

  it('outputs success message for successful update', async () => {
    const result: CResult<SocketSdkSuccessResult<'updateRepository'>['data']> =
      createSuccessResult({
        success: true,
      })

    await outputUpdateRepo(result, 'my-repository', 'text')

    expect(mockLogger.success).toHaveBeenCalledWith(
      'Repository `my-repository` updated successfully',
    )
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in text format', async () => {
    const mockFailMsg = vi.mocked(failMsgWithBadge)

    const result: CResult<SocketSdkSuccessResult<'updateRepository'>['data']> =
      createErrorResult('Repository not found', {
        cause: 'Not found error',
        code: 1,
      })

    await outputUpdateRepo(result, 'nonexistent-repo', 'text')

    expect(mockFailMsg).toHaveBeenCalledWith(
      'Repository not found',
      'Not found error',
    )
    expect(mockLogger.fail).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('handles markdown output format', async () => {
    const result: CResult<SocketSdkSuccessResult<'updateRepository'>['data']> =
      createSuccessResult({
        success: true,
      })

    await outputUpdateRepo(result, 'markdown-repo', 'markdown')

    expect(mockLogger.success).toHaveBeenCalledWith(
      'Repository `markdown-repo` updated successfully',
    )
  })

  it('handles repository name with special characters', async () => {
    const result: CResult<SocketSdkSuccessResult<'updateRepository'>['data']> =
      createSuccessResult({
        success: true,
      })

    await outputUpdateRepo(result, 'repo-with-dashes_and_underscores', 'text')

    expect(mockLogger.success).toHaveBeenCalledWith(
      'Repository `repo-with-dashes_and_underscores` updated successfully',
    )
  })

  it('handles empty repository name', async () => {
    const result: CResult<SocketSdkSuccessResult<'updateRepository'>['data']> =
      createSuccessResult({
        success: true,
      })

    await outputUpdateRepo(result, '', 'text')

    expect(mockLogger.success).toHaveBeenCalledWith(
      'Repository `` updated successfully',
    )
  })

  it('sets default exit code when code is undefined', async () => {
    const result: CResult<SocketSdkSuccessResult<'updateRepository'>['data']> =
      createErrorResult('Error without code')

    await outputUpdateRepo(result, 'test-repo', 'json')

    expect(process.exitCode).toBe(1)
  })
})
