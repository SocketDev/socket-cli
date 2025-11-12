/**
 * Unit tests for output-update-repo.
 *
 * Purpose:
 * Tests output formatting for repository update results. Validates change summaries
 * and diff formatting for update operations.
 *
 * Test Coverage:
 * - Successful update output formatting
 * - Error message formatting
 * - Multiple output formats (text, json, markdown)
 * - Updated field highlighting
 *
 * Testing Approach:
 * Uses result helpers to create test data. Validates formatted output strings showing
 * what changed during updates.
 *
 * Related Files:
 * - src/commands/repository/output-update-repo.mts (implementation)
 * - src/commands/repository/handle-update-repo.mts (handler)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { outputUpdateRepo } from '../../../../src/commands/repository/output-update-repo.mts'

import type { CResult } from '../../../../src/commands/repository/types.mts'
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

vi.mock('../../../../src/utils/output/result-json.mjs', () => ({
  serializeResultJson: vi.fn(result => JSON.stringify(result)),
}))

vi.mock('../../../../src/utils/error/fail-msg-with-badge.mts', () => ({
  failMsgWithBadge: vi.fn((msg, cause) => `${msg}: ${cause}`),
}))

describe('outputUpdateRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  it('outputs JSON format for successful result', async () => {
    const { serializeResultJson } = await vi.importMock(
      '../../../../src/utils/output/result-json.mjs',
    )
    const mockSerialize = vi.mocked(serializeResultJson)

    const result: CResult<SocketSdkSuccessResult<'updateRepository'>['data']> =
      {
        ok: true,
        data: {
          success: true,
        },
      }

    outputUpdateRepo(result, 'test-repo', 'json')

    expect(mockSerialize).toHaveBeenCalledWith(result)
    expect(mockLogger.log).toHaveBeenCalledWith(JSON.stringify(result))
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in JSON format', async () => {
    const result: CResult<SocketSdkSuccessResult<'updateRepository'>['data']> =
      {
        ok: false,
        code: 2,
        message: 'Unauthorized',
        cause: 'Invalid API token',
      }

    outputUpdateRepo(result, 'test-repo', 'json')

    expect(mockLogger.log).toHaveBeenCalled()
    expect(process.exitCode).toBe(2)
  })

  it('outputs success message for successful update', async () => {
    const result: CResult<SocketSdkSuccessResult<'updateRepository'>['data']> =
      {
        ok: true,
        data: {
          success: true,
        },
      }

    outputUpdateRepo(result, 'my-repository', 'text')

    expect(mockLogger.success).toHaveBeenCalledWith(
      'Repository `my-repository` updated successfully',
    )
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in text format', async () => {
    const { failMsgWithBadge } = await vi.importMock(
      '../../../../src/utils/error/fail-msg-with-badge.mts',
    )
    const mockFailMsg = vi.mocked(failMsgWithBadge)

    const result: CResult<SocketSdkSuccessResult<'updateRepository'>['data']> =
      {
        ok: false,
        code: 1,
        message: 'Repository not found',
        cause: 'Not found error',
      }

    outputUpdateRepo(result, 'nonexistent-repo', 'text')

    expect(mockFailMsg).toHaveBeenCalledWith(
      'Repository not found',
      'Not found error',
    )
    expect(mockLogger.fail).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('handles markdown output format', async () => {
    const result: CResult<SocketSdkSuccessResult<'updateRepository'>['data']> =
      {
        ok: true,
        data: {
          success: true,
        },
      }

    outputUpdateRepo(result, 'markdown-repo', 'markdown')

    expect(mockLogger.success).toHaveBeenCalledWith(
      'Repository `markdown-repo` updated successfully',
    )
  })

  it('handles repository name with special characters', async () => {
    const result: CResult<SocketSdkSuccessResult<'updateRepository'>['data']> =
      {
        ok: true,
        data: {
          success: true,
        },
      }

    outputUpdateRepo(result, 'repo-with-dashes_and_underscores', 'text')

    expect(mockLogger.success).toHaveBeenCalledWith(
      'Repository `repo-with-dashes_and_underscores` updated successfully',
    )
  })

  it('handles empty repository name', async () => {
    const result: CResult<SocketSdkSuccessResult<'updateRepository'>['data']> =
      {
        ok: true,
        data: {
          success: true,
        },
      }

    outputUpdateRepo(result, '', 'text')

    expect(mockLogger.success).toHaveBeenCalledWith(
      'Repository `` updated successfully',
    )
  })

  it('sets default exit code when code is undefined', async () => {
    const result: CResult<SocketSdkSuccessResult<'updateRepository'>['data']> =
      {
        ok: false,
        message: 'Error without code',
      }

    outputUpdateRepo(result, 'test-repo', 'json')

    expect(process.exitCode).toBe(1)
  })
})
