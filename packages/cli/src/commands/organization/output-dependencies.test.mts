import { describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
  setupTestEnvironment,
} from '../../../test/helpers/index.mts'
import { outputDependencies } from './output-dependencies.mts'

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
  default: vi.fn((_options, data) => `Table with ${data.length} rows`),
}))

vi.mock('yoctocolors-cjs', () => ({
  default: {
    bgRedBright: vi.fn(text => text),
    bold: vi.fn(text => text),
    cyan: vi.fn(text => text),
    green: vi.fn(text => text),
    red: vi.fn(text => text),
    yellow: vi.fn(text => text),
  },
}))

describe('outputDependencies', () => {
  setupTestEnvironment()

  it('outputs JSON format for successful result', async () => {
    const { serializeResultJson } = await vi.importMock(
      '../../utils/output/result-json.mjs',
    )

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

    expect(serializeResultJson).toHaveBeenCalledWith(result)
    expect(mockLogger.log).toHaveBeenCalledWith(JSON.stringify(result))
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in JSON format', async () => {
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

    expect(mockLogger.log).toHaveBeenCalled()
    expect(process.exitCode).toBe(2)
  })

  it('outputs markdown format with table', async () => {
    const chalkTable = await vi.importMock('chalk-table')

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

    expect(mockLogger.log).toHaveBeenCalledWith('# Organization dependencies')
    expect(mockLogger.log).toHaveBeenCalledWith('- Offset:', 20)
    expect(mockLogger.log).toHaveBeenCalledWith('- Limit:', 50)
    expect(mockLogger.log).toHaveBeenCalledWith(
      '- Is there more data after this?',
      'no',
    )
    expect(chalkTable.default).toHaveBeenCalledWith(
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
    const { failMsgWithBadge } = await vi.importMock(
      '../../utils/error/fail-msg-with-badge.mts',
    )

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

    expect(failMsgWithBadge).toHaveBeenCalledWith(
      'Failed to fetch dependencies',
      'Network error',
    )
    expect(mockLogger.fail).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('shows proper pagination info when more data is available', async () => {
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

    expect(mockLogger.log).toHaveBeenCalledWith(
      '- Is there more data after this?',
      'yes',
    )
  })

  it('handles empty dependencies list', async () => {
    const chalkTable = await vi.importMock('chalk-table')
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
