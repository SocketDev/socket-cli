import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../../src/helpers/index.mts'

import type { CResult } from '../../../../src/types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

describe('outputUpdateRepo', () => {
  beforeEach(async () => {
    vi.resetModules()
    process.exitCode = undefined
  })

  it('outputs JSON format for successful result', async () => {
    const mockLogger = {
      fail: vi.fn(),
      log: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const mockSerializeResultJson = vi.fn(result => JSON.stringify(result))

    vi.doMock('@socketsecurity/lib/logger', () => ({
      getDefaultLogger: () => mockLogger,
    }))

    vi.doMock('../../utils/output/result-json.mjs', () => ({
      serializeResultJson: mockSerializeResultJson,
    }))

    const { outputUpdateRepo } = await import('../../src/output-update-repo.mts')

    const result: CResult<SocketSdkSuccessResult<'updateRepository'>['data']> =
      createSuccessResult({
        success: true,
      })

    await outputUpdateRepo(result, 'test-repo', 'json')

    expect(mockSerializeResultJson).toHaveBeenCalledWith(result)
    expect(mockLogger.log).toHaveBeenCalledWith(JSON.stringify(result))
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in JSON format', async () => {
    const mockLogger = {
      fail: vi.fn(),
      log: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const mockSerializeResultJson = vi.fn(result => JSON.stringify(result))

    vi.doMock('@socketsecurity/lib/logger', () => ({
      getDefaultLogger: () => mockLogger,
    }))

    vi.doMock('../../utils/output/result-json.mjs', () => ({
      serializeResultJson: mockSerializeResultJson,
    }))

    const { outputUpdateRepo } = await import('../../src/output-update-repo.mts')

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
    const mockLogger = {
      fail: vi.fn(),
      log: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    vi.doMock('@socketsecurity/lib/logger', () => ({
      getDefaultLogger: () => mockLogger,
    }))

    const { outputUpdateRepo } = await import('../../src/output-update-repo.mts')

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
    const mockLogger = {
      fail: vi.fn(),
      log: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const mockFailMsgWithBadge = vi.fn((msg, cause) => `${msg}: ${cause}`)

    vi.doMock('@socketsecurity/lib/logger', () => ({
      getDefaultLogger: () => mockLogger,
    }))

    vi.doMock('../../utils/error/fail-msg-with-badge.mts', () => ({
      failMsgWithBadge: mockFailMsgWithBadge,
    }))

    const { outputUpdateRepo } = await import('../../src/output-update-repo.mts')

    const result: CResult<SocketSdkSuccessResult<'updateRepository'>['data']> =
      createErrorResult('Repository not found', {
        cause: 'Not found error',
        code: 1,
      })

    await outputUpdateRepo(result, 'nonexistent-repo', 'text')

    expect(mockFailMsgWithBadge).toHaveBeenCalledWith(
      'Repository not found',
      'Not found error',
    )
    expect(mockLogger.fail).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('handles markdown output format', async () => {
    const mockLogger = {
      fail: vi.fn(),
      log: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    vi.doMock('@socketsecurity/lib/logger', () => ({
      getDefaultLogger: () => mockLogger,
    }))

    const { outputUpdateRepo } = await import('../../src/output-update-repo.mts')

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
    const mockLogger = {
      fail: vi.fn(),
      log: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    vi.doMock('@socketsecurity/lib/logger', () => ({
      getDefaultLogger: () => mockLogger,
    }))

    const { outputUpdateRepo } = await import('../../src/output-update-repo.mts')

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
    const mockLogger = {
      fail: vi.fn(),
      log: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    vi.doMock('@socketsecurity/lib/logger', () => ({
      getDefaultLogger: () => mockLogger,
    }))

    const { outputUpdateRepo } = await import('../../src/output-update-repo.mts')

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
    const mockLogger = {
      fail: vi.fn(),
      log: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const mockSerializeResultJson = vi.fn(result => JSON.stringify(result))

    vi.doMock('@socketsecurity/lib/logger', () => ({
      getDefaultLogger: () => mockLogger,
    }))

    vi.doMock('../../utils/output/result-json.mjs', () => ({
      serializeResultJson: mockSerializeResultJson,
    }))

    const { outputUpdateRepo } = await import('../../src/output-update-repo.mts')

    const result: CResult<SocketSdkSuccessResult<'updateRepository'>['data']> =
      createErrorResult('Error without code')

    await outputUpdateRepo(result, 'test-repo', 'json')

    expect(process.exitCode).toBe(1)
  })
})
