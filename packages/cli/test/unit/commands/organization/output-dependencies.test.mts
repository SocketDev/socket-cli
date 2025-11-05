/**
 * Unit Tests: Organization Dependencies Output Formatter
 *
 * Purpose:
 * Tests the output formatting system for organization-wide dependency data. Validates
 * JSON and markdown/table output formats, pagination info display, error messaging,
 * and proper exit code setting based on result status.
 *
 * Test Coverage:
 * - JSON format output for successful results
 * - JSON format error output with exit codes
 * - Markdown/table format with chalk-table rendering
 * - Pagination metadata display (offset, limit, has more data)
 * - Error messaging in markdown format with badges
 * - Empty dependency list handling
 * - Default exit code setting when code is undefined
 *
 * Testing Approach:
 * Uses vi.doMock to reset module state between tests, mocking logger, chalk-table,
 * yoctocolors-cjs, and result serialization utilities. Tests verify output content
 * and exit code behavior.
 *
 * Related Files:
 * - src/commands/organization/output-dependencies.mts - Output formatter
 * - src/commands/organization/handle-dependencies.mts - Command handler
 * - src/commands/organization/fetch-dependencies.mts - Dependencies fetcher
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../../test/helpers/index.mts'

import type { CResult } from '../../../../src/types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

describe('outputDependencies', () => {
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

    const { outputDependencies } = await import(
      '../../../../src/commands/organization/output-dependencies.mts'
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

    const { outputDependencies } = await import(
      '../../../../src/commands/organization/output-dependencies.mts'
    )

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
        bgRedBright: vi.fn(text => text),
        bold: vi.fn(text => text),
        cyan: vi.fn(text => text),
        green: vi.fn(text => text),
        red: vi.fn(text => text),
        yellow: vi.fn(text => text),
      },
    }))

    const { outputDependencies } = await import(
      '../../../../src/commands/organization/output-dependencies.mts'
    )

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

    const { outputDependencies } = await import(
      '../../../../src/commands/organization/output-dependencies.mts'
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

    expect(mockFailMsgWithBadge).toHaveBeenCalledWith(
      'Failed to fetch dependencies',
      'Network error',
    )
    expect(mockLogger.fail).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('shows proper pagination info when more data is available', async () => {
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
        bgRedBright: vi.fn(text => text),
        bold: vi.fn(text => text),
        cyan: vi.fn(text => text),
        green: vi.fn(text => text),
        red: vi.fn(text => text),
        yellow: vi.fn(text => text),
      },
    }))

    const { outputDependencies } = await import(
      '../../../../src/commands/organization/output-dependencies.mts'
    )

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
        bgRedBright: vi.fn(text => text),
        bold: vi.fn(text => text),
        cyan: vi.fn(text => text),
        green: vi.fn(text => text),
        red: vi.fn(text => text),
        yellow: vi.fn(text => text),
      },
    }))

    const { outputDependencies } = await import(
      '../../../../src/commands/organization/output-dependencies.mts'
    )

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

    const { outputDependencies } = await import(
      '../../../../src/commands/organization/output-dependencies.mts'
    )

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
