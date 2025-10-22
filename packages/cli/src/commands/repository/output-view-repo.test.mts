import { beforeEach, describe, expect, it, vi } from 'vitest'

import { outputViewRepo } from './output-view-repo.mts'
import {
  createErrorResult,
  createSuccessResult,
  setupStandardOutputMocks,
} from '../../../test/helpers/index.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

// Mock the dependencies.
setupStandardOutputMocks()

vi.mock('chalk-table', () => ({
  default: vi.fn((_options, data) => `Table with ${data.length} row(s)`),
}))

vi.mock('yoctocolors-cjs', () => ({
  default: {
    magenta: vi.fn(text => text),
  },
}))

describe('outputViewRepo', () => {
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

    const result: CResult<SocketSdkSuccessResult<'createOrgRepo'>['data']> =
      createSuccessResult({
        archived: false,
        created_at: '2024-01-01T00:00:00Z',
        default_branch: 'main',
        homepage: 'https://example.com',
        id: 123,
        name: 'test-repo',
        visibility: 'public',
      })

    await outputViewRepo(result, 'json')

    expect(mockSerialize).toHaveBeenCalledWith(result)
    expect(mockLog).toHaveBeenCalledWith(JSON.stringify(result))
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in JSON format', async () => {
    const { logger } = await import('@socketsecurity/lib/logger')
    const mockLog = vi.mocked(logger.log)

    const result: CResult<SocketSdkSuccessResult<'createOrgRepo'>['data']> =
      createErrorResult('Unauthorized', {
        cause: 'Invalid API token',
        code: 2,
      })

    await outputViewRepo(result, 'json')

    expect(mockLog).toHaveBeenCalled()
    expect(process.exitCode).toBe(2)
  })

  it('outputs repository table in text format', async () => {
    const { logger } = await import('@socketsecurity/lib/logger')
    const chalkTable = await import('chalk-table')
    const mockSuccess = vi.mocked(logger.success)
    const mockChalkTable = vi.mocked(chalkTable.default)

    const repoData = {
      archived: true,
      created_at: '2023-05-15T10:30:00Z',
      default_branch: 'develop',
      homepage: 'https://my-project.com',
      id: 456,
      name: 'awesome-repo',
      visibility: 'private',
    }

    const result: CResult<SocketSdkSuccessResult<'createOrgRepo'>['data']> =
      createSuccessResult(repoData)

    await outputViewRepo(result, 'text')

    expect(mockChalkTable).toHaveBeenCalledWith(
      expect.objectContaining({
        columns: expect.arrayContaining([
          expect.objectContaining({ field: 'id' }),
          expect.objectContaining({ field: 'name' }),
          expect.objectContaining({ field: 'visibility' }),
          expect.objectContaining({ field: 'default_branch' }),
          expect.objectContaining({ field: 'homepage' }),
          expect.objectContaining({ field: 'archived' }),
          expect.objectContaining({ field: 'created_at' }),
        ]),
      }),
      [repoData],
    )
    expect(mockSuccess).toHaveBeenCalledWith('Table with 1 row(s)')
  })

  it('outputs error in text format', async () => {
    const { logger } = await import('@socketsecurity/lib/logger')
    const { failMsgWithBadge } = await import(
      '../../utils/error/fail-msg-with-badge.mts'
    )
    const mockFail = vi.mocked(logger.fail)
    const mockFailMsg = vi.mocked(failMsgWithBadge)

    const result: CResult<SocketSdkSuccessResult<'createOrgRepo'>['data']> =
      createErrorResult('Repository not found', {
        cause: 'Not found error',
        code: 1,
      })

    await outputViewRepo(result, 'text')

    expect(mockFailMsg).toHaveBeenCalledWith(
      'Repository not found',
      'Not found error',
    )
    expect(mockFail).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('handles repository with null homepage', async () => {
    const { logger: _logger } = await import('@socketsecurity/lib/logger')
    const chalkTable = await import('chalk-table')
    const mockChalkTable = vi.mocked(chalkTable.default)

    const repoData = {
      archived: false,
      created_at: '2024-02-20T14:45:30Z',
      default_branch: 'main',
      homepage: null,
      id: 789,
      name: 'no-homepage-repo',
      visibility: 'public',
    }

    const result: CResult<SocketSdkSuccessResult<'createOrgRepo'>['data']> =
      createSuccessResult(repoData)

    await outputViewRepo(result, 'text')

    expect(mockChalkTable).toHaveBeenCalledWith(expect.any(Object), [repoData])
  })

  it('handles repository with empty name', async () => {
    const chalkTable = await import('chalk-table')
    const mockChalkTable = vi.mocked(chalkTable.default)

    const repoData = {
      archived: false,
      created_at: '2024-01-01T00:00:00Z',
      default_branch: 'main',
      homepage: '',
      id: 1,
      name: '',
      visibility: 'public',
    }

    const result: CResult<SocketSdkSuccessResult<'createOrgRepo'>['data']> =
      createSuccessResult(repoData)

    await outputViewRepo(result, 'markdown')

    expect(mockChalkTable).toHaveBeenCalledWith(expect.any(Object), [repoData])
  })

  it('handles very long repository data', async () => {
    const chalkTable = await import('chalk-table')
    const mockChalkTable = vi.mocked(chalkTable.default)

    const repoData = {
      archived: false,
      created_at: '2024-12-01T09:15:22Z',
      default_branch:
        'feature/very-long-branch-name-that-exceeds-normal-length',
      homepage:
        'https://very-long-domain-name-that-might-cause-display-issues.example.com/path',
      id: 999_999,
      name: 'repository-with-a-very-long-name-that-might-cause-table-formatting-issues',
      visibility: 'internal',
    }

    const result: CResult<SocketSdkSuccessResult<'createOrgRepo'>['data']> =
      createSuccessResult(repoData)

    await outputViewRepo(result, 'text')

    expect(mockChalkTable).toHaveBeenCalledWith(expect.any(Object), [repoData])
  })

  it('sets default exit code when code is undefined', async () => {
    const result: CResult<SocketSdkSuccessResult<'createOrgRepo'>['data']> =
      createErrorResult('Error without code')

    await outputViewRepo(result, 'json')

    expect(process.exitCode).toBe(1)
  })
})
