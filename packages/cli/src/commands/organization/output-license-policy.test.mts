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

import { outputLicensePolicy } from './output-license-policy.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'
import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { mdHeader, mdTableOfPairs } from '../../utils/output/markdown.mts'

describe('outputLicensePolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  it('outputs JSON format for successful result', async () => {
    const result = createSuccessResult({
      license_policy: {
        MIT: { allowed: true },
        'GPL-3.0': { allowed: false },
        'Apache-2.0': { allowed: true },
      },
    })

    await outputLicensePolicy(result as any, 'json')

    expect(serializeResultJson).toHaveBeenCalledWith(result)
    expect(mockLogger.log).toHaveBeenCalledWith(JSON.stringify(result))
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in JSON format', async () => {
    const result = createErrorResult('Unauthorized', {
      code: 2,
      cause: 'Invalid API token',
    })

    await outputLicensePolicy(result, 'json')

    expect(mockLogger.log).toHaveBeenCalled()
    expect(process.exitCode).toBe(2)
  })

  it('outputs text format with license table', async () => {
    const result = createSuccessResult({
      license_policy: {
        MIT: { allowed: true },
        'BSD-3-Clause': { allowed: true },
        'GPL-3.0': { allowed: false },
      },
    })

    await outputLicensePolicy(result as any, 'text')

    expect(mockLogger.info).toHaveBeenCalledWith('Use --json to get the full result')
    expect(mockLogger.log).toHaveBeenCalledWith('# License policy')
    expect(mdTableOfPairs).toHaveBeenCalledWith(
      expect.arrayContaining([
        ['BSD-3-Clause', ' yes'],
        ['GPL-3.0', ' no'],
        ['MIT', ' yes'],
      ]),
      ['License Name', 'Allowed'],
    )
  })

  it('outputs error in text format', async () => {
    const result = createErrorResult('Failed to fetch policy', {
      code: 1,
      cause: 'Network error',
    })

    await outputLicensePolicy(result, 'text')

    expect(failMsgWithBadge).toHaveBeenCalledWith(
      'Failed to fetch policy',
      'Network error',
    )
    expect(mockLogger.fail).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('handles markdown output format', async () => {
    const result = createSuccessResult({
      license_policy: {
        MIT: { allowed: true },
      },
    })

    await outputLicensePolicy(result as any, 'markdown')

    expect(mockLogger.log).toHaveBeenCalledWith('# License policy')
    expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('Table'))
  })

  it('handles empty license policy', async () => {
    const result = createSuccessResult({
      license_policy: {},
    })

    await outputLicensePolicy(result as any, 'text')

    expect(mdTableOfPairs).toHaveBeenCalledWith([], ['License Name', 'Allowed'])
  })

  it('handles null license policy', async () => {
    const result = createSuccessResult({
      license_policy: null,
    })

    await outputLicensePolicy(result as any, 'text')

    expect(mdTableOfPairs).toHaveBeenCalledWith([], ['License Name', 'Allowed'])
  })

  it('sets default exit code when code is undefined', async () => {
    const result = createErrorResult('Error')

    await outputLicensePolicy(result as any, 'json')

    expect(process.exitCode).toBe(1)
  })
})
