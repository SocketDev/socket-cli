import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CResult } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

// Mock the dependencies.
vi.mock('@socketsecurity/lib/logger', () => ({
  logger: {
    fail: vi.fn(),
    log: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('../../utils/output/result-json.mjs', () => ({
  serializeResultJson: vi.fn(result => JSON.stringify(result)),
}))

vi.mock('../../utils/error/fail-msg-with-badge.mts', () => ({
  failMsgWithBadge: vi.fn((msg, cause) => `${msg}: ${cause}`),
}))

describe('outputCreateRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  it('outputs JSON format for successful result', async () => {
    const { outputCreateRepo } = await import('./output-create-repo.mts')
    const { logger } = await vi.importMock('@socketsecurity/lib/logger')
    const { serializeResultJson } = await vi.importMock(
      '../../utils/output/result-json.mjs'
    )
    const mockLog = vi.mocked(logger.log)
    const mockSerialize = vi.mocked(serializeResultJson)

    const result: CResult<SocketSdkSuccessResult<'createRepository'>['data']> = {
      ok: true,
      data: {
        slug: 'my-repo',
      },
    }

    outputCreateRepo(result, 'my-repo', 'json')

    expect(mockSerialize).toHaveBeenCalledWith(result)
    expect(mockLog).toHaveBeenCalledWith(JSON.stringify(result))
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in JSON format', async () => {
    const { outputCreateRepo } = await import('./output-create-repo.mts')
    const { logger } = await vi.importMock('@socketsecurity/lib/logger')
    const mockLog = vi.mocked(logger.log)

    const result: CResult<SocketSdkSuccessResult<'createRepository'>['data']> = {
      ok: false,
      code: 2,
      message: 'Unauthorized',
      cause: 'Invalid API token',
    }

    outputCreateRepo(result, 'my-repo', 'json')

    expect(mockLog).toHaveBeenCalled()
    expect(process.exitCode).toBe(2)
  })

  it('outputs success message when slug matches requested name', async () => {
    const { outputCreateRepo } = await import('./output-create-repo.mts')
    const { logger } = await vi.importMock('@socketsecurity/lib/logger')
    const mockSuccess = vi.mocked(logger.success)

    const result: CResult<SocketSdkSuccessResult<'createRepository'>['data']> = {
      ok: true,
      data: {
        slug: 'my-awesome-repo',
      },
    }

    outputCreateRepo(result, 'my-awesome-repo', 'text')

    expect(mockSuccess).toHaveBeenCalledWith(
      'OK. Repository created successfully, slug: `my-awesome-repo`',
    )
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs success message with warning when slug differs from requested name', async () => {
    const { outputCreateRepo } = await import('./output-create-repo.mts')
    const { logger } = await vi.importMock('@socketsecurity/lib/logger')
    const mockSuccess = vi.mocked(logger.success)

    const result: CResult<SocketSdkSuccessResult<'createRepository'>['data']> = {
      ok: true,
      data: {
        slug: 'my-repo-sanitized',
      },
    }

    outputCreateRepo(result, 'My Repo With Spaces!', 'text')

    expect(mockSuccess).toHaveBeenCalledWith(
      'OK. Repository created successfully, slug: `my-repo-sanitized` (Warning: slug is not the same as name that was requested!)',
    )
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in text format', async () => {
    const { outputCreateRepo } = await import('./output-create-repo.mts')
    const { logger } = await vi.importMock('@socketsecurity/lib/logger')
    const { failMsgWithBadge } = await vi.importMock(
      '../../utils/error/fail-msg-with-badge.mts'
    )
    const mockFail = vi.mocked(logger.fail)
    const mockFailMsg = vi.mocked(failMsgWithBadge)

    const result: CResult<SocketSdkSuccessResult<'createRepository'>['data']> = {
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
    expect(mockFail).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('handles markdown output format', async () => {
    const { outputCreateRepo } = await import('./output-create-repo.mts')
    const { logger } = await vi.importMock('@socketsecurity/lib/logger')
    const mockSuccess = vi.mocked(logger.success)

    const result: CResult<SocketSdkSuccessResult<'createRepository'>['data']> = {
      ok: true,
      data: {
        slug: 'markdown-repo',
      },
    }

    outputCreateRepo(result, 'markdown-repo', 'markdown')

    expect(mockSuccess).toHaveBeenCalledWith(
      'OK. Repository created successfully, slug: `markdown-repo`',
    )
  })

  it('handles empty slug properly', async () => {
    const { outputCreateRepo } = await import('./output-create-repo.mts')
    const { logger } = await vi.importMock('@socketsecurity/lib/logger')
    const mockSuccess = vi.mocked(logger.success)

    const result: CResult<SocketSdkSuccessResult<'createRepository'>['data']> = {
      ok: true,
      data: {
        slug: '',
      },
    }

    outputCreateRepo(result, 'original-name', 'text')

    expect(mockSuccess).toHaveBeenCalledWith(
      'OK. Repository created successfully, slug: `` (Warning: slug is not the same as name that was requested!)',
    )
  })

  it('sets default exit code when code is undefined', async () => {
    const { outputCreateRepo } = await import('./output-create-repo.mts')
    const result: CResult<SocketSdkSuccessResult<'createRepository'>['data']> = {
      ok: false,
      message: 'Error without code',
    }

    outputCreateRepo(result, 'test-repo', 'json')

    expect(process.exitCode).toBe(1)
  })
})
