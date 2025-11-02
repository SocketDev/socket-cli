import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../test/helpers/index.mts'

describe('outputLicensePolicy', () => {
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
    vi.doMock('../../utils/output/result-json.mjs', () => ({
      serializeResultJson: mockSerializeResultJson,
    }))

    // Dynamic import AFTER mocks.
    const { outputLicensePolicy } = await import('./output-license-policy.mts')

    const result = createSuccessResult({
      license_policy: {
        MIT: { allowed: true },
        'GPL-3.0': { allowed: false },
        'Apache-2.0': { allowed: true },
      },
    })

    process.exitCode = undefined
    await outputLicensePolicy(result as any, 'json')

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
    vi.doMock('../../utils/output/result-json.mjs', () => ({
      serializeResultJson: mockSerializeResultJson,
    }))

    // Dynamic import AFTER mocks.
    const { outputLicensePolicy } = await import('./output-license-policy.mts')

    const result = createErrorResult('Unauthorized', {
      code: 2,
      cause: 'Invalid API token',
    })

    process.exitCode = undefined
    await outputLicensePolicy(result, 'json')

    expect(mockLogger.log).toHaveBeenCalled()
    expect(process.exitCode).toBe(2)
  })

  it('outputs text format with license table', async () => {
    // Create mocks INSIDE each test.
    const mockLogger = {
      fail: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const mockMdTableOfPairs = vi.fn(pairs => `Table with ${pairs.length} rows`)

    // Use vi.doMock (NOT vi.mock).
    vi.doMock('@socketsecurity/lib/logger', () => ({
      getDefaultLogger: () => mockLogger,
      logger: mockLogger,
    }))
    vi.doMock('../../utils/output/markdown.mts', () => ({
      mdHeader: vi.fn(title => `# ${title}`),
      mdTableOfPairs: mockMdTableOfPairs,
    }))

    // Dynamic import AFTER mocks.
    const { outputLicensePolicy } = await import('./output-license-policy.mts')

    const result = createSuccessResult({
      license_policy: {
        MIT: { allowed: true },
        'BSD-3-Clause': { allowed: true },
        'GPL-3.0': { allowed: false },
      },
    })

    process.exitCode = undefined
    await outputLicensePolicy(result as any, 'text')

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Use --json to get the full result',
    )
    expect(mockLogger.log).toHaveBeenCalledWith('# License policy')
    expect(mockMdTableOfPairs).toHaveBeenCalledWith(
      expect.arrayContaining([
        ['BSD-3-Clause', ' yes'],
        ['GPL-3.0', ' no'],
        ['MIT', ' yes'],
      ]),
      ['License Name', 'Allowed'],
    )
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
    vi.doMock('../../utils/error/fail-msg-with-badge.mts', () => ({
      failMsgWithBadge: mockFailMsgWithBadge,
    }))

    // Dynamic import AFTER mocks.
    const { outputLicensePolicy } = await import('./output-license-policy.mts')

    const result = createErrorResult('Failed to fetch policy', {
      code: 1,
      cause: 'Network error',
    })

    process.exitCode = undefined
    await outputLicensePolicy(result, 'text')

    expect(mockFailMsgWithBadge).toHaveBeenCalledWith(
      'Failed to fetch policy',
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
    const mockMdTableOfPairs = vi.fn(pairs => `Table with ${pairs.length} rows`)

    // Use vi.doMock (NOT vi.mock).
    vi.doMock('@socketsecurity/lib/logger', () => ({
      getDefaultLogger: () => mockLogger,
      logger: mockLogger,
    }))
    vi.doMock('../../utils/output/markdown.mts', () => ({
      mdHeader: vi.fn(title => `# ${title}`),
      mdTableOfPairs: mockMdTableOfPairs,
    }))

    // Dynamic import AFTER mocks.
    const { outputLicensePolicy } = await import('./output-license-policy.mts')

    const result = createSuccessResult({
      license_policy: {
        MIT: { allowed: true },
      },
    })

    process.exitCode = undefined
    await outputLicensePolicy(result as any, 'markdown')

    expect(mockLogger.log).toHaveBeenCalledWith('# License policy')
    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.stringContaining('Table'),
    )
  })

  it('handles empty license policy', async () => {
    // Create mocks INSIDE each test.
    const mockLogger = {
      fail: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const mockMdTableOfPairs = vi.fn(pairs => `Table with ${pairs.length} rows`)

    // Use vi.doMock (NOT vi.mock).
    vi.doMock('@socketsecurity/lib/logger', () => ({
      getDefaultLogger: () => mockLogger,
      logger: mockLogger,
    }))
    vi.doMock('../../utils/output/markdown.mts', () => ({
      mdHeader: vi.fn(title => `# ${title}`),
      mdTableOfPairs: mockMdTableOfPairs,
    }))

    // Dynamic import AFTER mocks.
    const { outputLicensePolicy } = await import('./output-license-policy.mts')

    const result = createSuccessResult({
      license_policy: {},
    })

    process.exitCode = undefined
    await outputLicensePolicy(result as any, 'text')

    expect(mockMdTableOfPairs).toHaveBeenCalledWith(
      [],
      ['License Name', 'Allowed'],
    )
  })

  it('handles null license policy', async () => {
    // Create mocks INSIDE each test.
    const mockLogger = {
      fail: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const mockMdTableOfPairs = vi.fn(pairs => `Table with ${pairs.length} rows`)

    // Use vi.doMock (NOT vi.mock).
    vi.doMock('@socketsecurity/lib/logger', () => ({
      getDefaultLogger: () => mockLogger,
      logger: mockLogger,
    }))
    vi.doMock('../../utils/output/markdown.mts', () => ({
      mdHeader: vi.fn(title => `# ${title}`),
      mdTableOfPairs: mockMdTableOfPairs,
    }))

    // Dynamic import AFTER mocks.
    const { outputLicensePolicy } = await import('./output-license-policy.mts')

    const result = createSuccessResult({
      license_policy: null,
    })

    process.exitCode = undefined
    await outputLicensePolicy(result as any, 'text')

    expect(mockMdTableOfPairs).toHaveBeenCalledWith(
      [],
      ['License Name', 'Allowed'],
    )
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
    vi.doMock('../../utils/output/result-json.mjs', () => ({
      serializeResultJson: mockSerializeResultJson,
    }))

    // Dynamic import AFTER mocks.
    const { outputLicensePolicy } = await import('./output-license-policy.mts')

    const result = createErrorResult('Error')

    process.exitCode = undefined
    await outputLicensePolicy(result as any, 'json')

    expect(process.exitCode).toBe(1)
  })
})
