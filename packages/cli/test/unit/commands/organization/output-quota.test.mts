/**
 * Unit Tests: API Token Quota Output Formatter
 *
 * Purpose:
 * Tests the output formatting system for API token quota data. Validates JSON and text/markdown
 * output formats, error messaging, exit code setting, and quota value display including zero
 * quota scenarios.
 *
 * Test Coverage:
 * - JSON format output for successful results
 * - JSON format error output with exit codes
 * - Text format with quota information display
 * - Text format error output with badges
 * - Markdown format output
 * - Zero quota handling
 * - Default text output when format unspecified
 * - Default exit code setting when code is undefined
 *
 * Testing Approach:
 * Uses vi.doMock to reset module state between tests, mocking logger, result serialization,
 * markdown utilities, and error formatting. Tests verify output content and exit code behavior.
 *
 * Related Files:
 * - src/commands/organization/output-quota.mts - Output formatter
 * - src/commands/organization/handle-quota.mts - Command handler
 * - src/commands/organization/fetch-quota.mts - Quota fetcher
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../../test/helpers/index.mts'

describe('outputQuota', () => {
  beforeEach(async () => {
    vi.resetModules()
  })

  it('outputs JSON format for successful result', async () => {
    // Create mocks INSIDE each test.
    const mockLogger = {
      fail: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const mockSerializeResultJson = vi.fn(result => JSON.stringify(result))

    // Use vi.doMock (NOT vi.mock).
    vi.doMock('@socketsecurity/lib/logger', () => ({
      getDefaultLogger: () => mockLogger,
      logger: mockLogger,
    }))
    vi.doMock('../../../../src/utils/output/result-json.mjs', () => ({
      serializeResultJson: mockSerializeResultJson,
    }))

    // Dynamic import AFTER mocks.
    const { outputQuota } = await import('../../../../src/commands/organization/output-quota.mts')

    const result = createSuccessResult({
      quota: 1000,
    })

    process.exitCode = undefined
    await outputQuota(result as any, 'json')

    expect(mockSerializeResultJson).toHaveBeenCalledWith(result)
    expect(mockLogger.log).toHaveBeenCalledWith(JSON.stringify(result))
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in JSON format', async () => {
    // Create mocks INSIDE each test.
    const mockLogger = {
      fail: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const mockSerializeResultJson = vi.fn(result => JSON.stringify(result))

    // Use vi.doMock (NOT vi.mock).
    vi.doMock('@socketsecurity/lib/logger', () => ({
      getDefaultLogger: () => mockLogger,
      logger: mockLogger,
    }))
    vi.doMock('../../../../src/utils/output/result-json.mjs', () => ({
      serializeResultJson: mockSerializeResultJson,
    }))

    // Dynamic import AFTER mocks.
    const { outputQuota } = await import('../../../../src/commands/organization/output-quota.mts')

    const result = createErrorResult('Unauthorized', {
      code: 2,
      cause: 'Invalid API token',
    })

    process.exitCode = undefined
    await outputQuota(result, 'json')

    expect(mockLogger.log).toHaveBeenCalled()
    expect(process.exitCode).toBe(2)
  })

  it('outputs text format with quota information', async () => {
    // Create mocks INSIDE each test.
    const mockLogger = {
      fail: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    // Use vi.doMock (NOT vi.mock).
    vi.doMock('@socketsecurity/lib/logger', () => ({
      getDefaultLogger: () => mockLogger,
      logger: mockLogger,
    }))

    // Dynamic import AFTER mocks.
    const { outputQuota } = await import('../../../../src/commands/organization/output-quota.mts')

    const result = createSuccessResult({
      quota: 500,
    })

    process.exitCode = undefined
    await outputQuota(result as any, 'text')

    expect(mockLogger.log).toHaveBeenCalledWith(
      'Quota left on the current API token: 500',
    )
    expect(mockLogger.log).toHaveBeenCalledWith('')
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in text format', async () => {
    // Create mocks INSIDE each test.
    const mockLogger = {
      fail: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const mockFailMsgWithBadge = vi.fn((msg, cause) => `${msg}: ${cause}`)

    // Use vi.doMock (NOT vi.mock).
    vi.doMock('@socketsecurity/lib/logger', () => ({
      getDefaultLogger: () => mockLogger,
      logger: mockLogger,
    }))
    vi.doMock('../../../../src/utils/error/fail-msg-with-badge.mts', () => ({
      failMsgWithBadge: mockFailMsgWithBadge,
    }))

    // Dynamic import AFTER mocks.
    const { outputQuota } = await import('../../../../src/commands/organization/output-quota.mts')

    const result = createErrorResult('Failed to fetch quota', {
      code: 1,
      cause: 'Network error',
    })

    process.exitCode = undefined
    await outputQuota(result, 'text')

    expect(mockFailMsgWithBadge).toHaveBeenCalledWith(
      'Failed to fetch quota',
      'Network error',
    )
    expect(mockLogger.fail).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('handles markdown output format', async () => {
    // Create mocks INSIDE each test.
    const mockLogger = {
      fail: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    // Use vi.doMock (NOT vi.mock).
    vi.doMock('@socketsecurity/lib/logger', () => ({
      getDefaultLogger: () => mockLogger,
      logger: mockLogger,
    }))
    vi.doMock('../../../../src/utils/output/markdown.mts', () => ({
      mdHeader: vi.fn(title => `# ${title}`),
    }))

    // Dynamic import AFTER mocks.
    const { outputQuota } = await import('../../../../src/commands/organization/output-quota.mts')

    const result = createSuccessResult({
      quota: 750,
    })

    process.exitCode = undefined
    await outputQuota(result as any, 'markdown')

    expect(mockLogger.log).toHaveBeenCalledWith('# Quota')
    expect(mockLogger.log).toHaveBeenCalledWith('')
    expect(mockLogger.log).toHaveBeenCalledWith(
      'Quota left on the current API token: 750',
    )
  })

  it('handles zero quota correctly', async () => {
    // Create mocks INSIDE each test.
    const mockLogger = {
      fail: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    // Use vi.doMock (NOT vi.mock).
    vi.doMock('@socketsecurity/lib/logger', () => ({
      getDefaultLogger: () => mockLogger,
      logger: mockLogger,
    }))

    // Dynamic import AFTER mocks.
    const { outputQuota } = await import('../../../../src/commands/organization/output-quota.mts')

    const result = createSuccessResult({
      quota: 0,
    })

    process.exitCode = undefined
    await outputQuota(result as any, 'text')

    expect(mockLogger.log).toHaveBeenCalledWith(
      'Quota left on the current API token: 0',
    )
  })

  it('uses default text output when no format specified', async () => {
    // Create mocks INSIDE each test.
    const mockLogger = {
      fail: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    // Use vi.doMock (NOT vi.mock).
    vi.doMock('@socketsecurity/lib/logger', () => ({
      getDefaultLogger: () => mockLogger,
      logger: mockLogger,
    }))

    // Dynamic import AFTER mocks.
    const { outputQuota } = await import('../../../../src/commands/organization/output-quota.mts')

    const result = createSuccessResult({
      quota: 100,
    })

    process.exitCode = undefined
    await outputQuota(result as any)

    expect(mockLogger.log).toHaveBeenCalledWith(
      'Quota left on the current API token: 100',
    )
    expect(mockLogger.log).toHaveBeenCalledWith('')
  })

  it('sets default exit code when code is undefined', async () => {
    // Create mocks INSIDE each test.
    const mockLogger = {
      fail: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const mockSerializeResultJson = vi.fn(result => JSON.stringify(result))

    // Use vi.doMock (NOT vi.mock).
    vi.doMock('@socketsecurity/lib/logger', () => ({
      getDefaultLogger: () => mockLogger,
      logger: mockLogger,
    }))
    vi.doMock('../../../../src/utils/output/result-json.mjs', () => ({
      serializeResultJson: mockSerializeResultJson,
    }))

    // Dynamic import AFTER mocks.
    const { outputQuota } = await import('../../../../src/commands/organization/output-quota.mts')

    const result = createErrorResult('Error')

    process.exitCode = undefined
    await outputQuota(result as any, 'json')

    expect(process.exitCode).toBe(1)
  })
})
