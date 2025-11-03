import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../../../src/commands/../../../test/helpers/index.mts'

import type { CResult } from '../../../../src/src/commands/repository/types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

describe('outputViewRepo', () => {
  beforeEach(async () => {
    vi.resetModules()
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

    vi.doMock('../../../../src/utils/output/result-json.mjs', () => ({
      serializeResultJson: mockSerializeResultJson,
    }))

    const { outputViewRepo } = await import('../../../../src/commands/repository/output-view-repo.mts')

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

    vi.doMock('../../../../src/utils/output/result-json.mjs', () => ({
      serializeResultJson: mockSerializeResultJson,
    }))

    const { outputViewRepo } = await import('../../../../src/commands/repository/output-view-repo.mts')

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
    const mockLogger = {
      fail: vi.fn(),
      log: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const mockChalkTable = vi.fn(
      (_options, data) => `Table with ${data.length} row(s)`,
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

    const { outputViewRepo } = await import('../../../../src/commands/repository/output-view-repo.mts')

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

    vi.doMock('../../../../src/utils/error/fail-msg-with-badge.mts', () => ({
      failMsgWithBadge: mockFailMsgWithBadge,
    }))

    const { outputViewRepo } = await import('../../../../src/commands/repository/output-view-repo.mts')

    const result: CResult<SocketSdkSuccessResult<'createRepository'>['data']> =
      createErrorResult('Repository not found', {
        cause: 'Not found error',
        code: 1,
      })

    await outputViewRepo(result, 'text')

    expect(mockFailMsgWithBadge).toHaveBeenCalledWith(
      'Repository not found',
      'Not found error',
    )
    expect(mockLogger.fail).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('handles repository with null homepage', async () => {
    const mockLogger = {
      fail: vi.fn(),
      log: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const mockChalkTable = vi.fn(
      (_options, data) => `Table with ${data.length} row(s)`,
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

    const { outputViewRepo } = await import('../../../../src/commands/repository/output-view-repo.mts')

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

    expect(mockLogger.log).toHaveBeenCalled()
  })

  it('handles repository with empty name', async () => {
    const mockLogger = {
      fail: vi.fn(),
      log: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const mockChalkTable = vi.fn(
      (_options, data) => `Table with ${data.length} row(s)`,
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

    const { outputViewRepo } = await import('../../../../src/commands/repository/output-view-repo.mts')

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

    expect(mockLogger.log).toHaveBeenCalled()
  })

  it('handles very long repository data', async () => {
    const mockLogger = {
      fail: vi.fn(),
      log: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const mockChalkTable = vi.fn(
      (_options, data) => `Table with ${data.length} row(s)`,
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

    const { outputViewRepo } = await import('../../../../src/commands/repository/output-view-repo.mts')

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

    expect(mockLogger.log).toHaveBeenCalled()
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

    vi.doMock('../../../../src/utils/output/result-json.mjs', () => ({
      serializeResultJson: mockSerializeResultJson,
    }))

    const { outputViewRepo } = await import('../../../../src/commands/repository/output-view-repo.mts')

    const result: CResult<SocketSdkSuccessResult<'createRepository'>['data']> =
      createErrorResult('Error without code')

    await outputViewRepo(result, 'json')

    expect(process.exitCode).toBe(1)
  })
})
