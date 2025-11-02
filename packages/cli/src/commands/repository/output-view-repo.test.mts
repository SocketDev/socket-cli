import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../test/helpers/index.mts'
import { outputViewRepo } from './output-view-repo.mts'

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
    const { serializeResultJson } = await vi.importMock(
      '../../utils/output/result-json.mjs',
    )

    const mockSerialize = vi.mocked(serializeResultJson)

    const result: CResult<SocketSdkSuccessResult<'createRepository'>['data']> =
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
    expect(mockLogger.log).toHaveBeenCalledWith(JSON.stringify(result))
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in JSON format', async () => {
    const result: CResult<SocketSdkSuccessResult<'createRepository'>['data']> =
      createErrorResult('Unauthorized', {
        cause: 'Invalid API token',
        code: 2,
      })

    await outputViewRepo(result, 'json')

    expect(mockLogger.log).toHaveBeenCalled()
    expect(process.exitCode).toBe(2)
  })

  it('outputs repository table in text format', async () => {
    const chalkTable = await vi.importMock('chalk-table')

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

    const result: CResult<SocketSdkSuccessResult<'createRepository'>['data']> =
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
    expect(mockLogger.log).toHaveBeenCalledWith('Table with 1 row(s)')
  })

  it('outputs error in text format', async () => {
    const { failMsgWithBadge } = await vi.importMock(
      '../../utils/error/fail-msg-with-badge.mts',
    )

    const mockFailMsg = vi.mocked(failMsgWithBadge)

    const result: CResult<SocketSdkSuccessResult<'createRepository'>['data']> =
      createErrorResult('Repository not found', {
        cause: 'Not found error',
        code: 1,
      })

    await outputViewRepo(result, 'text')

    expect(mockFailMsg).toHaveBeenCalledWith(
      'Repository not found',
      'Not found error',
    )
    expect(mockLogger.fail).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('handles repository with null homepage', async () => {
    const chalkTable = await vi.importMock('chalk-table')
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

    const result: CResult<SocketSdkSuccessResult<'createRepository'>['data']> =
      createSuccessResult(repoData)

    await outputViewRepo(result, 'text')

    expect(mockChalkTable).toHaveBeenCalledWith(expect.any(Object), [repoData])
  })

  it('handles repository with empty name', async () => {
    const chalkTable = await vi.importMock('chalk-table')
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

    const result: CResult<SocketSdkSuccessResult<'createRepository'>['data']> =
      createSuccessResult(repoData)

    await outputViewRepo(result, 'markdown')

    expect(mockChalkTable).toHaveBeenCalledWith(expect.any(Object), [repoData])
  })

  it('handles very long repository data', async () => {
    const chalkTable = await vi.importMock('chalk-table')
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

    const result: CResult<SocketSdkSuccessResult<'createRepository'>['data']> =
      createSuccessResult(repoData)

    await outputViewRepo(result, 'text')

    expect(mockChalkTable).toHaveBeenCalledWith(expect.any(Object), [repoData])
  })

  it('sets default exit code when code is undefined', async () => {
    const result: CResult<SocketSdkSuccessResult<'createRepository'>['data']> =
      createErrorResult('Error without code')

    await outputViewRepo(result, 'json')

    expect(process.exitCode).toBe(1)
  })
})
