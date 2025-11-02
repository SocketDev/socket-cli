import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../test/helpers/index.mts'

// Mock the dependencies.
const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
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

vi.mock('../../utils/output/markdown.mts', () => ({
  mdHeader: vi.fn(title => `# ${title}`),
  mdTableOfPairs: vi.fn(pairs => `Table with ${pairs.length} rows`),
}))

describe('outputLicensePolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  it('outputs JSON format for successful result', async () => {
    const { outputLicensePolicy } = await import('./output-license-policy.mts')
    const { logger } = await vi.importMock('@socketsecurity/lib/logger')
    const { serializeResultJson } = await vi.importMock(
      '../../utils/output/result-json.mjs',
    )
    const mockLog = vi.mocked(logger.log)
    const mockSerialize = vi.mocked(serializeResultJson)

    const result = createSuccessResult({
      license_policy: {
        MIT: { allowed: true },
        'GPL-3.0': { allowed: false },
        'Apache-2.0': { allowed: true },
      },
    })

    await outputLicensePolicy(result as any, 'json')

    expect(mockSerialize).toHaveBeenCalledWith(result)
    expect(mockLog).toHaveBeenCalledWith(JSON.stringify(result))
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in JSON format', async () => {
    const { outputLicensePolicy } = await import('./output-license-policy.mts')
    const { logger } = await vi.importMock('@socketsecurity/lib/logger')
    const mockLog = vi.mocked(logger.log)

    const result = createErrorResult('Unauthorized', {
      code: 2,
      cause: 'Invalid API token',
    })

    await outputLicensePolicy(result, 'json')

    expect(mockLog).toHaveBeenCalled()
    expect(process.exitCode).toBe(2)
  })

  it('outputs text format with license table', async () => {
    const { outputLicensePolicy } = await import('./output-license-policy.mts')
    const { logger } = await vi.importMock('@socketsecurity/lib/logger')
    const { mdTableOfPairs } = await vi.importMock(
      '../../utils/output/markdown.mts',
    )
    const mockLog = vi.mocked(logger.log)
    const mockInfo = vi.mocked(logger.info)
    const mockTable = vi.mocked(mdTableOfPairs)

    const result = createSuccessResult({
      license_policy: {
        MIT: { allowed: true },
        'BSD-3-Clause': { allowed: true },
        'GPL-3.0': { allowed: false },
      },
    })

    await outputLicensePolicy(result as any, 'text')

    expect(mockInfo).toHaveBeenCalledWith('Use --json to get the full result')
    expect(mockLog).toHaveBeenCalledWith('# License policy')
    expect(mockTable).toHaveBeenCalledWith(
      expect.arrayContaining([
        ['BSD-3-Clause', ' yes'],
        ['GPL-3.0', ' no'],
        ['MIT', ' yes'],
      ]),
      ['License Name', 'Allowed'],
    )
  })

  it('outputs error in text format', async () => {
    const { outputLicensePolicy } = await import('./output-license-policy.mts')
    const { logger } = await vi.importMock('@socketsecurity/lib/logger')
    const { failMsgWithBadge } = await vi.importMock(
      '../../utils/error/fail-msg-with-badge.mts',
    )
    const mockFail = vi.mocked(logger.fail)
    const mockFailMsg = vi.mocked(failMsgWithBadge)

    const result = createErrorResult('Failed to fetch policy', {
      code: 1,
      cause: 'Network error',
    })

    await outputLicensePolicy(result, 'text')

    expect(mockFailMsg).toHaveBeenCalledWith(
      'Failed to fetch policy',
      'Network error',
    )
    expect(mockFail).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('handles markdown output format', async () => {
    const { outputLicensePolicy } = await import('./output-license-policy.mts')
    const { logger } = await vi.importMock('@socketsecurity/lib/logger')
    const mockLog = vi.mocked(logger.log)

    const result = createSuccessResult({
      license_policy: {
        MIT: { allowed: true },
      },
    })

    await outputLicensePolicy(result as any, 'markdown')

    expect(mockLog).toHaveBeenCalledWith('# License policy')
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Table'))
  })

  it('handles empty license policy', async () => {
    const { outputLicensePolicy } = await import('./output-license-policy.mts')
    const { mdTableOfPairs } = await vi.importMock(
      '../../utils/output/markdown.mts',
    )
    const mockTable = vi.mocked(mdTableOfPairs)

    const result = createSuccessResult({
      license_policy: {},
    })

    await outputLicensePolicy(result as any, 'text')

    expect(mockTable).toHaveBeenCalledWith([], ['License Name', 'Allowed'])
  })

  it('handles null license policy', async () => {
    const { outputLicensePolicy } = await import('./output-license-policy.mts')
    const { mdTableOfPairs } = await vi.importMock(
      '../../utils/output/markdown.mts',
    )
    const mockTable = vi.mocked(mdTableOfPairs)

    const result = createSuccessResult({
      license_policy: null,
    })

    await outputLicensePolicy(result as any, 'text')

    expect(mockTable).toHaveBeenCalledWith([], ['License Name', 'Allowed'])
  })

  it('sets default exit code when code is undefined', async () => {
    const { outputLicensePolicy } = await import('./output-license-policy.mts')
    const result = createErrorResult('Error')

    await outputLicensePolicy(result as any, 'json')

    expect(process.exitCode).toBe(1)
  })
})
