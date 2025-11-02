import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the dependencies - must be declared before other imports.
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

import {
  createErrorResult,
  createSuccessResult,
} from '../../../test/helpers/index.mts'
import { outputDeleteRepo } from './output-delete-repo.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

describe('outputDeleteRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  it('outputs JSON format for successful result', async () => {
    const { serializeResultJson } = await vi.importMock(
      '../../utils/output/result-json.mjs',
    )
    const mockSerialize = vi.mocked(serializeResultJson)

    const result: CResult<SocketSdkSuccessResult<'deleteRepository'>['data']> =
      createSuccessResult({
        success: true,
      })

    await outputDeleteRepo(result, 'test-repo', 'json')

    expect(mockSerialize).toHaveBeenCalledWith(result)
    expect(mockLogger.log).toHaveBeenCalledWith(JSON.stringify(result))
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in JSON format', async () => {
    const result: CResult<SocketSdkSuccessResult<'deleteRepository'>['data']> =
      createErrorResult('Unauthorized', {
        cause: 'Invalid API token',
        code: 2,
      })

    await outputDeleteRepo(result, 'test-repo', 'json')

    expect(mockLogger.log).toHaveBeenCalled()
    expect(process.exitCode).toBe(2)
  })

  it('outputs success message for successful deletion', async () => {
    const result: CResult<SocketSdkSuccessResult<'deleteRepository'>['data']> =
      createSuccessResult({
        success: true,
      })

    await outputDeleteRepo(result, 'my-repository', 'text')

    expect(mockLogger.success).toHaveBeenCalledWith(
      'OK. Repository `my-repository` deleted successfully',
    )
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in text format', async () => {
    const { failMsgWithBadge } = await vi.importMock(
      '../../utils/error/fail-msg-with-badge.mts',
    )
    const mockFailMsg = vi.mocked(failMsgWithBadge)

    const result: CResult<SocketSdkSuccessResult<'deleteRepository'>['data']> =
      createErrorResult('Repository not found', {
        cause: 'Not found error',
        code: 1,
      })

    await outputDeleteRepo(result, 'nonexistent-repo', 'text')

    expect(mockFailMsg).toHaveBeenCalledWith(
      'Repository not found',
      'Not found error',
    )
    expect(mockLogger.fail).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('handles markdown output format', async () => {
    const result: CResult<SocketSdkSuccessResult<'deleteRepository'>['data']> =
      createSuccessResult({
        success: true,
      })

    await outputDeleteRepo(result, 'markdown-repo', 'markdown')

    expect(mockLogger.success).toHaveBeenCalledWith(
      'OK. Repository `markdown-repo` deleted successfully',
    )
  })

  it('handles repository name with special characters', async () => {
    const result: CResult<SocketSdkSuccessResult<'deleteRepository'>['data']> =
      createSuccessResult({
        success: true,
      })

    await outputDeleteRepo(result, 'repo-with-dashes_and_underscores', 'text')

    expect(mockLogger.success).toHaveBeenCalledWith(
      'OK. Repository `repo-with-dashes_and_underscores` deleted successfully',
    )
  })

  it('handles empty repository name', async () => {
    const result: CResult<SocketSdkSuccessResult<'deleteRepository'>['data']> =
      createSuccessResult({
        success: true,
      })

    await outputDeleteRepo(result, '', 'text')

    expect(mockLogger.success).toHaveBeenCalledWith(
      'OK. Repository `` deleted successfully',
    )
  })

  it('sets default exit code when code is undefined', async () => {
    const result: CResult<SocketSdkSuccessResult<'deleteRepository'>['data']> =
      createErrorResult('Error without code')

    await outputDeleteRepo(result, 'test-repo', 'json')

    expect(process.exitCode).toBe(1)
  })
})
