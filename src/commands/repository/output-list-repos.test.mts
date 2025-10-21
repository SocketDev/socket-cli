import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createErrorResult,
  createSuccessResult,
  setupStandardOutputMocks,
} from '../../../test/helpers/index.mts'

import type { CResult } from '../../types.mts'
import { outputListRepos } from './output-list-repos.mts'

setupStandardOutputMocks()

vi.mock('chalk-table', () => ({
  default: vi.fn((_options, data) => `Table with ${data.length} rows`),
}))

vi.mock('yoctocolors-cjs', () => ({
  default: {
    magenta: vi.fn(text => text),
  },
}))

describe('outputListRepos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  it('outputs JSON format for successful result with pagination', async () => {
    const { logger } = await import('@socketsecurity/lib/logger')
    const { serializeResultJson } = await import(
      '../../utils/serialize/result-json.mts'
    )
    const mockLog = vi.mocked(logger.log)
    const mockSerialize = vi.mocked(serializeResultJson)

    const result: CResult<SocketSdkSuccessResult<'getOrgRepoList'>['data']> =
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

    expect(mockSerialize).toHaveBeenCalledWith({
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
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('ok'))
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in JSON format', async () => {
    const { logger } = await import('@socketsecurity/lib/logger')
    const mockLog = vi.mocked(logger.log)

    const result: CResult<SocketSdkSuccessResult<'getOrgRepoList'>['data']> =
      createErrorResult('Unauthorized', {
        cause: 'Invalid API token',
        code: 2,
      })

    await outputListRepos(result, 'json', 1, null, 'created_at', 25, 'desc')

    expect(mockLog).toHaveBeenCalled()
    expect(process.exitCode).toBe(2)
  })

  it('outputs text format with repository table', async () => {
    const { logger } = await import('@socketsecurity/lib/logger')
    const chalkTable = await import('chalk-table')
    const mockLog = vi.mocked(logger.log)
    const mockInfo = vi.mocked(logger.info)
    const mockChalkTable = vi.mocked(chalkTable.default)

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

    const result: CResult<SocketSdkSuccessResult<'getOrgRepoList'>['data']> =
      createSuccessResult({
        results: repos,
      })

    await outputListRepos(result, 'text', 2, 3, 'updated_at', 50, 'desc')

    expect(mockLog).toHaveBeenCalledWith(
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
    expect(mockInfo).toHaveBeenCalledWith(
      'This is page 2. Server indicated there are more results available on page 3...',
    )
    expect(mockInfo).toHaveBeenCalledWith(
      '(Hint: you can use `socket repository list --page 3`)',
    )
  })

  it('outputs error in text format', async () => {
    const { logger } = await import('@socketsecurity/lib/logger')
    const { failMsgWithBadge } = await import(
      '../../utils/error/fail-msg-with-badge.mts'
    )
    const mockFail = vi.mocked(logger.fail)
    const mockFailMsg = vi.mocked(failMsgWithBadge)

    const result: CResult<SocketSdkSuccessResult<'getOrgRepoList'>['data']> =
      createErrorResult('Failed to fetch repositories', {
        cause: 'Network error',
        code: 1,
      })

    await outputListRepos(result, 'text', 1, null, 'name', 10, 'asc')

    expect(mockFailMsg).toHaveBeenCalledWith(
      'Failed to fetch repositories',
      'Network error',
    )
    expect(mockFail).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('shows proper message when on last page', async () => {
    const { logger } = await import('@socketsecurity/lib/logger')
    const mockInfo = vi.mocked(logger.info)

    const result: CResult<SocketSdkSuccessResult<'getOrgRepoList'>['data']> =
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

    expect(mockInfo).toHaveBeenCalledWith(
      'This is page 5. Server indicated this is the last page with results.',
    )
  })

  it('shows proper message when displaying entire list', async () => {
    const { logger } = await import('@socketsecurity/lib/logger')
    const mockInfo = vi.mocked(logger.info)

    const result: CResult<SocketSdkSuccessResult<'getOrgRepoList'>['data']> =
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

    expect(mockInfo).toHaveBeenCalledWith(
      'This should be the entire list available on the server.',
    )
  })

  it('handles empty repository list', async () => {
    const { logger } = await import('@socketsecurity/lib/logger')
    const chalkTable = await import('chalk-table')
    const mockChalkTable = vi.mocked(chalkTable.default)

    const result: CResult<SocketSdkSuccessResult<'getOrgRepoList'>['data']> =
      createSuccessResult({
        results: [],
      })

    await outputListRepos(result, 'text', 1, null, 'name', 10, 'desc')

    expect(mockChalkTable).toHaveBeenCalledWith(expect.any(Object), [])
  })

  it('sets default exit code when code is undefined', async () => {
    const result: CResult<SocketSdkSuccessResult<'getOrgRepoList'>['data']> =
      createErrorResult('Error without code')

    await outputListRepos(result, 'json', 1, null, 'name', 10, 'asc')

    expect(process.exitCode).toBe(1)
  })
})
