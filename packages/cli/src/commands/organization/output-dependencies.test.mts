import { describe, expect, it, vi } from 'vitest'

import { outputDependencies } from './output-dependencies.mts'
import {
  createErrorResult,
  createSuccessResult,
  setupStandardOutputMocks,
  setupTestEnvironment,
} from '../../../test/helpers/index.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

setupStandardOutputMocks()

vi.mock('chalk-table', () => ({
  default: vi.fn((_options, data) => `Table with ${data.length} rows`),
}))

vi.mock('yoctocolors-cjs', () => ({
  default: {
    cyan: vi.fn(text => text),
  },
}))

describe('outputDependencies', () => {
  setupTestEnvironment()

  it('outputs JSON format for successful result', async () => {
    const { logger: _logger } = await import('@socketsecurity/lib/logger')
    const { serializeResultJson } = await import(
      '../../utils/serialize/result-json.mts'
    )
    const mockLog = vi.mocked(logger.log)
    const mockSerialize = vi.mocked(serializeResultJson)

    const result: CResult<
      SocketSdkSuccessResult<'searchDependencies'>['data']
    > = createSuccessResult({
      end: false,
      rows: [
        {
          branch: 'main',
          direct: true,
          name: 'test-package',
          namespace: '@test',
          repository: 'test-repo',
          type: 'npm',
          version: '1.0.0',
        },
      ],
    })

    await outputDependencies(result, {
      limit: 10,
      offset: 0,
      outputKind: 'json',
    })

    expect(mockSerialize).toHaveBeenCalledWith(result)
    expect(mockLog).toHaveBeenCalledWith(JSON.stringify(result))
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in JSON format', async () => {
    const { logger: _logger } = await import('@socketsecurity/lib/logger')
    const mockLog = vi.mocked(logger.log)

    const result: CResult<
      SocketSdkSuccessResult<'searchDependencies'>['data']
    > = createErrorResult('Unauthorized', {
      cause: 'Invalid API token',
      code: 2,
    })

    await outputDependencies(result, {
      limit: 10,
      offset: 0,
      outputKind: 'json',
    })

    expect(mockLog).toHaveBeenCalled()
    expect(process.exitCode).toBe(2)
  })

  it('outputs markdown format with table', async () => {
    const { logger: _logger } = await import('@socketsecurity/lib/logger')
    const chalkTable = await import('chalk-table')
    const mockLog = vi.mocked(logger.log)
    const mockChalkTable = vi.mocked(chalkTable.default)

    const result: CResult<
      SocketSdkSuccessResult<'searchDependencies'>['data']
    > = createSuccessResult({
      end: true,
      rows: [
        {
          branch: 'main',
          direct: false,
          name: 'lodash',
          namespace: '',
          repository: 'my-app',
          type: 'npm',
          version: '4.17.21',
        },
      ],
    })

    await outputDependencies(result, {
      limit: 50,
      offset: 20,
      outputKind: 'text',
    })

    expect(mockLog).toHaveBeenCalledWith('# Organization dependencies')
    expect(mockLog).toHaveBeenCalledWith('- Offset:', 20)
    expect(mockLog).toHaveBeenCalledWith('- Limit:', 50)
    expect(mockLog).toHaveBeenCalledWith(
      '- Is there more data after this?',
      'no',
    )
    expect(mockChalkTable).toHaveBeenCalledWith(
      expect.objectContaining({
        columns: expect.arrayContaining([
          expect.objectContaining({ field: 'type' }),
          expect.objectContaining({ field: 'namespace' }),
          expect.objectContaining({ field: 'name' }),
          expect.objectContaining({ field: 'version' }),
          expect.objectContaining({ field: 'repository' }),
          expect.objectContaining({ field: 'branch' }),
          expect.objectContaining({ field: 'direct' }),
        ]),
      }),
      result.data.rows,
    )
  })

  it('outputs error in markdown format', async () => {
    const { logger: _logger } = await import('@socketsecurity/lib/logger')
    const { failMsgWithBadge } = await import(
      '../../utils/error/fail-msg-with-badge.mts'
    )
    const mockFail = vi.mocked(logger.fail)
    const mockFailMsg = vi.mocked(failMsgWithBadge)

    const result: CResult<
      SocketSdkSuccessResult<'searchDependencies'>['data']
    > = createErrorResult('Failed to fetch dependencies', {
      cause: 'Network error',
      code: 1,
    })

    await outputDependencies(result, {
      limit: 10,
      offset: 0,
      outputKind: 'text',
    })

    expect(mockFailMsg).toHaveBeenCalledWith(
      'Failed to fetch dependencies',
      'Network error',
    )
    expect(mockFail).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('shows proper pagination info when more data is available', async () => {
    const { logger: _logger } = await import('@socketsecurity/lib/logger')
    const mockLog = vi.mocked(logger.log)

    const result: CResult<
      SocketSdkSuccessResult<'searchDependencies'>['data']
    > = createSuccessResult({
      end: false,
      rows: [
        {
          branch: 'dev',
          direct: true,
          name: 'express',
          namespace: '',
          repository: 'api-server',
          type: 'npm',
          version: '4.18.2',
        },
      ],
    })

    await outputDependencies(result, {
      limit: 25,
      offset: 100,
      outputKind: 'text',
    })

    expect(mockLog).toHaveBeenCalledWith(
      '- Is there more data after this?',
      'yes',
    )
  })

  it('handles empty dependencies list', async () => {
    const { logger: _logger } = await import('@socketsecurity/lib/logger')
    const chalkTable = await import('chalk-table')
    const mockChalkTable = vi.mocked(chalkTable.default)

    const result: CResult<
      SocketSdkSuccessResult<'searchDependencies'>['data']
    > = createSuccessResult({
      end: true,
      rows: [],
    })

    await outputDependencies(result, {
      limit: 10,
      offset: 0,
      outputKind: 'text',
    })

    expect(mockChalkTable).toHaveBeenCalledWith(expect.any(Object), [])
  })

  it('sets default exit code when code is undefined', async () => {
    const result: CResult<
      SocketSdkSuccessResult<'searchDependencies'>['data']
    > = createErrorResult('Error without code')

    await outputDependencies(result, {
      limit: 10,
      offset: 0,
      outputKind: 'json',
    })

    expect(process.exitCode).toBe(1)
  })
})
