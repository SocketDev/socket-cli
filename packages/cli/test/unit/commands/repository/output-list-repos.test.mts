import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../../src/helpers/index.mts'

import type { CResult } from '../../../../src/types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

describe('outputListRepos', () => {
  beforeEach(async () => {
    vi.resetModules()
    process.exitCode = undefined
  })

  it('outputs JSON format for successful result with pagination', async () => {
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

    const { outputListRepos } = await import('./output-list-repos.mts')

    const result: CResult<SocketSdkSuccessResult<'listRepositories'>['data']> =
      createSuccessResult({
        results: [
          {
            archived: false,
            default_branch: 'main',
            id: 123,
            name: 'test-repo',
            visibility: 'public',
          },
        ],
      })

    await outputListRepos(result, 'json', 1, 2, 'name', 10, 'asc')

    expect(mockSerializeResultJson).toHaveBeenCalledWith({
      ok: true,
      data: {
        data: result.data,
        direction: 'asc',
        nextPage: 2,
        page: 1,
        perPage: 10,
        sort: 'name',
      },
    })
    expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('ok'))
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

    const { outputListRepos } = await import('./output-list-repos.mts')

    const result: CResult<SocketSdkSuccessResult<'listRepositories'>['data']> =
      createErrorResult('Unauthorized', {
        cause: 'Invalid API token',
        code: 2,
      })

    await outputListRepos(result, 'json', 1, null, 'created_at', 25, 'desc')

    expect(mockLogger.log).toHaveBeenCalled()
    expect(process.exitCode).toBe(2)
  })

  it('outputs text format with repository table', async () => {
    const mockLogger = {
      fail: vi.fn(),
      log: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const mockChalkTable = vi.fn(
      (_options, data) => `Table with ${data.length} rows`,
    )

    vi.doMock('@socketsecurity/lib/logger', () => ({
      getDefaultLogger: () => mockLogger,
    }))

    vi.doMock('chalk-table', () => ({
      default: mockChalkTable,
    }))

    vi.doMock('yoctocolors-cjs', () => ({
      default: {
        magenta: vi.fn(text => text),
      },
    }))

    const { outputListRepos } = await import('./output-list-repos.mts')

    const repos = [
      {
        archived: false,
        default_branch: 'main',
        id: 456,
        name: 'awesome-project',
        visibility: 'private',
      },
      {
        archived: true,
        default_branch: 'develop',
        id: 789,
        name: 'old-project',
        visibility: 'public',
      },
    ]

    const result: CResult<SocketSdkSuccessResult<'listRepositories'>['data']> =
      createSuccessResult({
        results: repos,
      })

    await outputListRepos(result, 'text', 2, 3, 'updated_at', 50, 'desc')

    expect(mockLogger.log).toHaveBeenCalledWith(
      'Result page: 2, results per page: 50, sorted by: updated_at, direction: desc',
    )
    expect(mockChalkTable).toHaveBeenCalledWith(
      expect.objectContaining({
        columns: expect.arrayContaining([
          expect.objectContaining({ field: 'id' }),
          expect.objectContaining({ field: 'name' }),
          expect.objectContaining({ field: 'visibility' }),
          expect.objectContaining({ field: 'default_branch' }),
          expect.objectContaining({ field: 'archived' }),
        ]),
      }),
      repos,
    )
    expect(mockLogger.info).toHaveBeenCalledWith(
      'This is page 2. Server indicated there are more results available on page 3...',
    )
    expect(mockLogger.info).toHaveBeenCalledWith(
      '(Hint: you can use `socket repository list --page 3`)',
    )
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

    const { outputListRepos } = await import('./output-list-repos.mts')

    const result: CResult<SocketSdkSuccessResult<'listRepositories'>['data']> =
      createErrorResult('Failed to fetch repositories', {
        cause: 'Network error',
        code: 1,
      })

    await outputListRepos(result, 'text', 1, null, 'name', 10, 'asc')

    expect(mockFailMsgWithBadge).toHaveBeenCalledWith(
      'Failed to fetch repositories',
      'Network error',
    )
    expect(mockLogger.fail).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('shows proper message when on last page', async () => {
    const mockLogger = {
      fail: vi.fn(),
      log: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const mockChalkTable = vi.fn(
      (_options, data) => `Table with ${data.length} rows`,
    )

    vi.doMock('@socketsecurity/lib/logger', () => ({
      getDefaultLogger: () => mockLogger,
    }))

    vi.doMock('chalk-table', () => ({
      default: mockChalkTable,
    }))

    vi.doMock('yoctocolors-cjs', () => ({
      default: {
        magenta: vi.fn(text => text),
      },
    }))

    const { outputListRepos } = await import('./output-list-repos.mts')

    const result: CResult<SocketSdkSuccessResult<'listRepositories'>['data']> =
      createSuccessResult({
        results: [
          {
            archived: false,
            default_branch: 'main',
            id: 100,
            name: 'final-repo',
            visibility: 'private',
          },
        ],
      })

    await outputListRepos(result, 'text', 5, null, 'name', 20, 'asc')

    expect(mockLogger.info).toHaveBeenCalledWith(
      'This is page 5. Server indicated this is the last page with results.',
    )
  })

  it('shows proper message when displaying entire list', async () => {
    const mockLogger = {
      fail: vi.fn(),
      log: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const mockChalkTable = vi.fn(
      (_options, data) => `Table with ${data.length} rows`,
    )

    vi.doMock('@socketsecurity/lib/logger', () => ({
      getDefaultLogger: () => mockLogger,
    }))

    vi.doMock('chalk-table', () => ({
      default: mockChalkTable,
    }))

    vi.doMock('yoctocolors-cjs', () => ({
      default: {
        magenta: vi.fn(text => text),
      },
    }))

    const { outputListRepos } = await import('./output-list-repos.mts')

    const result: CResult<SocketSdkSuccessResult<'listRepositories'>['data']> =
      createSuccessResult({
        results: [],
      })

    await outputListRepos(
      result,
      'text',
      1,
      null,
      'name',
      Number.POSITIVE_INFINITY,
      'asc',
    )

    expect(mockLogger.info).toHaveBeenCalledWith(
      'This should be the entire list available on the server.',
    )
  })

  it('handles empty repository list', async () => {
    const mockLogger = {
      fail: vi.fn(),
      log: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const mockChalkTable = vi.fn(
      (_options, data) => `Table with ${data.length} rows`,
    )

    vi.doMock('@socketsecurity/lib/logger', () => ({
      getDefaultLogger: () => mockLogger,
    }))

    vi.doMock('chalk-table', () => ({
      default: mockChalkTable,
    }))

    vi.doMock('yoctocolors-cjs', () => ({
      default: {
        magenta: vi.fn(text => text),
      },
    }))

    const { outputListRepos } = await import('./output-list-repos.mts')

    const result: CResult<SocketSdkSuccessResult<'listRepositories'>['data']> =
      createSuccessResult({
        results: [],
      })

    await outputListRepos(result, 'text', 1, null, 'name', 10, 'desc')

    expect(mockChalkTable).toHaveBeenCalledWith(expect.any(Object), [])
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

    const { outputListRepos } = await import('./output-list-repos.mts')

    const result: CResult<SocketSdkSuccessResult<'listRepositories'>['data']> =
      createErrorResult('Error without code')

    await outputListRepos(result, 'json', 1, null, 'name', 10, 'asc')

    expect(process.exitCode).toBe(1)
  })
})
