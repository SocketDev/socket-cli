import { beforeEach, describe, expect, it, vi } from 'vitest'

import { outputLicensePolicy } from './output-license-policy.mts'
import {
  createErrorResult,
  createSuccessResult,
  setupOutputWithTableMocks,
} from '../../../test/helpers/index.mts'

// Mock the dependencies.
setupOutputWithTableMocks()

describe('outputLicensePolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  it('outputs JSON format for successful result', async () => {
    const { logger } = await import('@socketsecurity/lib/logger')
    const { serializeResultJson } = await import(
      '../../utils/serialize/result-json.mts'
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
    const { logger } = await import('@socketsecurity/lib/logger')
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
    const { logger } = await import('@socketsecurity/lib/logger')
    const { mdTableOfPairs } = await import('../../utils/output/markdown.mts')
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
    const { logger } = await import('@socketsecurity/lib/logger')
    const { failMsgWithBadge } = await import(
      '../../utils/error/fail-msg-with-badge.mts'
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
    const { logger } = await import('@socketsecurity/lib/logger')
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
    const { logger } = await import('@socketsecurity/lib/logger')
    const { mdTableOfPairs } = await import('../../utils/output/markdown.mts')
    const mockTable = vi.mocked(mdTableOfPairs)

    const result = createSuccessResult({
      license_policy: {},
    })

    await outputLicensePolicy(result as any, 'text')

    expect(mockTable).toHaveBeenCalledWith([], ['License Name', 'Allowed'])
  })

  it('handles null license policy', async () => {
    const { logger } = await import('@socketsecurity/lib/logger')
    const { mdTableOfPairs } = await import('../../utils/output/markdown.mts')
    const mockTable = vi.mocked(mdTableOfPairs)

    const result = createSuccessResult({
      license_policy: null,
    })

    await outputLicensePolicy(result as any, 'text')

    expect(mockTable).toHaveBeenCalledWith([], ['License Name', 'Allowed'])
  })

  it('sets default exit code when code is undefined', async () => {
    const result = createErrorResult('Error')

    await outputLicensePolicy(result as any, 'json')

    expect(process.exitCode).toBe(1)
  })
})
