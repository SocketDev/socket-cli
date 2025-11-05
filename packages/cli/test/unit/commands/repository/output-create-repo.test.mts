/**
 * Unit tests for output-create-repo.
 *
 * Purpose:
 * Tests output formatting for repository creation results. Validates text, JSON, and
 * markdown formatting for successful and failed repository creation.
 *
 * Test Coverage:
 * - Successful creation output formatting
 * - Error message formatting
 * - Multiple output formats (text, json, markdown)
 * - Repository metadata display
 *
 * Testing Approach:
 * Uses result helpers to create test data. Validates formatted output strings across
 * different output modes.
 *
 * Related Files:
 * - src/commands/repository/output-create-repo.mts (implementation)
 * - src/commands/repository/handle-create-repo.mts (handler)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { outputCreateRepo } from '../../../../src/commands/repository/output-create-repo.mts'

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

describe('outputCreateRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  it('outputs JSON format for successful result', async () => {
    const { serializeResultJson } = await vi.importMock(
      '../../../../src/utils/output/result-json.mjs',
    )
    const mockSerialize = vi.mocked(serializeResultJson)

    const result: CResult<SocketSdkSuccessResult<'createRepository'>['data']> =
      {
        ok: true,
        data: {
          slug: 'my-repo',
        },
      }

    outputCreateRepo(result, 'my-repo', 'json')

    expect(mockSerialize).toHaveBeenCalledWith(result)
    expect(mockLogger.log).toHaveBeenCalledWith(JSON.stringify(result))
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in JSON format', async () => {
    const result: CResult<SocketSdkSuccessResult<'createRepository'>['data']> =
      {
        ok: false,
        code: 2,
        message: 'Unauthorized',
        cause: 'Invalid API token',
      }

    outputCreateRepo(result, 'my-repo', 'json')

    expect(mockLogger.log).toHaveBeenCalled()
    expect(process.exitCode).toBe(2)
  })

  it('outputs success message when slug matches requested name', async () => {
    const result: CResult<SocketSdkSuccessResult<'createRepository'>['data']> =
      {
        ok: true,
        data: {
          slug: 'my-awesome-repo',
        },
      }

    outputCreateRepo(result, 'my-awesome-repo', 'text')

    expect(mockLogger.success).toHaveBeenCalledWith(
      'OK. Repository created successfully, slug: `my-awesome-repo`',
    )
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs success message with warning when slug differs from requested name', async () => {
    const result: CResult<SocketSdkSuccessResult<'createRepository'>['data']> =
      {
        ok: true,
        data: {
          slug: 'my-repo-sanitized',
        },
      }

    outputCreateRepo(result, 'My Repo With Spaces!', 'text')

    expect(mockLogger.success).toHaveBeenCalledWith(
      'OK. Repository created successfully, slug: `my-repo-sanitized` (Warning: slug is not the same as name that was requested!)',
    )
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in text format', async () => {
    const { failMsgWithBadge } = await vi.importMock(
      '../../../../src/utils/error/fail-msg-with-badge.mts',
    )
    const mockFailMsg = vi.mocked(failMsgWithBadge)

    const result: CResult<SocketSdkSuccessResult<'createRepository'>['data']> =
      {
        ok: false,
        code: 1,
        message: 'Repository already exists',
        cause: 'Conflict error',
      }

    outputCreateRepo(result, 'existing-repo', 'text')

    expect(mockFailMsg).toHaveBeenCalledWith(
      'Repository already exists',
      'Conflict error',
    )
    expect(mockLogger.fail).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('handles markdown output format', async () => {
    const result: CResult<SocketSdkSuccessResult<'createRepository'>['data']> =
      {
        ok: true,
        data: {
          slug: 'markdown-repo',
        },
      }

    outputCreateRepo(result, 'markdown-repo', 'markdown')

    expect(mockLogger.success).toHaveBeenCalledWith(
      'OK. Repository created successfully, slug: `markdown-repo`',
    )
  })

  it('handles empty slug properly', async () => {
    const result: CResult<SocketSdkSuccessResult<'createRepository'>['data']> =
      {
        ok: true,
        data: {
          slug: '',
        },
      }

    outputCreateRepo(result, 'original-name', 'text')

    expect(mockLogger.success).toHaveBeenCalledWith(
      'OK. Repository created successfully, slug: `` (Warning: slug is not the same as name that was requested!)',
    )
  })

  it('sets default exit code when code is undefined', async () => {
    const result: CResult<SocketSdkSuccessResult<'createRepository'>['data']> =
      {
        ok: false,
        message: 'Error without code',
      }

    outputCreateRepo(result, 'test-repo', 'json')

    expect(process.exitCode).toBe(1)
  })
})
