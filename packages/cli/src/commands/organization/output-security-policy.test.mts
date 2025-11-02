import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../test/helpers/index.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

// Mock the dependencies.
vi.mock('@socketsecurity/lib/logger', async importOriginal => {
  const original = await importOriginal()
  const mockLogger = {
    fail: vi.fn(),
    log: vi.fn(),
  }
  return {
    ...original,
    getDefaultLogger: () => mockLogger,
    logger: mockLogger,
  }
})

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

describe('outputSecurityPolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  it('outputs JSON format for successful result', async () => {
    const { outputSecurityPolicy } = await import(
      './output-security-policy.mts'
    )
    const { logger } = await vi.importMock('@socketsecurity/lib/logger')
    const { serializeResultJson } = await vi.importMock(
      '../../utils/output/result-json.mjs',
    )
    const mockLog = vi.mocked(logger.log)
    const mockSerialize = vi.mocked(serializeResultJson)

    const result: CResult<
      SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']
    > = createSuccessResult({
      securityPolicyDefault: 'warn',
      securityPolicyRules: {
        malware: { action: 'error' },
        typosquatting: { action: 'warn' },
        telemetry: { action: 'ignore' },
      },
    })

    await outputSecurityPolicy(result, 'json')

    expect(mockSerialize).toHaveBeenCalledWith(result)
    expect(mockLog).toHaveBeenCalledWith(JSON.stringify(result))
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in JSON format', async () => {
    const { outputSecurityPolicy } = await import(
      './output-security-policy.mts'
    )
    const { logger } = await vi.importMock('@socketsecurity/lib/logger')
    const mockLog = vi.mocked(logger.log)

    const result: CResult<
      SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']
    > = createErrorResult('Unauthorized', {
      cause: 'Invalid API token',
      code: 2,
    })

    await outputSecurityPolicy(result, 'json')

    expect(mockLog).toHaveBeenCalled()
    expect(process.exitCode).toBe(2)
  })

  it('outputs text format with security policy table', async () => {
    const { outputSecurityPolicy } = await import(
      './output-security-policy.mts'
    )
    const { logger } = await vi.importMock('@socketsecurity/lib/logger')
    const { mdTableOfPairs } = await vi.importMock(
      '../../utils/output/markdown.mts',
    )
    const mockLog = vi.mocked(logger.log)
    const mockTable = vi.mocked(mdTableOfPairs)

    const result: CResult<
      SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']
    > = createSuccessResult({
      securityPolicyDefault: 'error',
      securityPolicyRules: {
        dynamicRequire: { action: 'warn' },
        malware: { action: 'error' },
        networkAccess: { action: 'defer' },
      },
    })

    await outputSecurityPolicy(result, 'text')

    expect(mockLog).toHaveBeenCalledWith('# Security policy')
    expect(mockLog).toHaveBeenCalledWith('')
    expect(mockLog).toHaveBeenCalledWith(
      'The default security policy setting is: "error"',
    )
    expect(mockLog).toHaveBeenCalledWith(
      'These are the security policies per setting for your organization:',
    )
    expect(mockTable).toHaveBeenCalledWith(
      expect.arrayContaining([
        ['dynamicRequire', 'warn'],
        ['malware', 'error'],
        ['networkAccess', 'defer'],
      ]),
      ['name', 'action'],
    )
  })

  it('outputs error in text format', async () => {
    const { outputSecurityPolicy } = await import(
      './output-security-policy.mts'
    )
    const { logger } = await vi.importMock('@socketsecurity/lib/logger')
    const { failMsgWithBadge } = await vi.importMock(
      '../../utils/error/fail-msg-with-badge.mts',
    )
    const mockFail = vi.mocked(logger.fail)
    const mockFailMsg = vi.mocked(failMsgWithBadge)

    const result: CResult<
      SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']
    > = createErrorResult('Failed to fetch security policy', {
      cause: 'Network error',
      code: 1,
    })

    await outputSecurityPolicy(result, 'text')

    expect(mockFailMsg).toHaveBeenCalledWith(
      'Failed to fetch security policy',
      'Network error',
    )
    expect(mockFail).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('handles empty security policy rules', async () => {
    const { outputSecurityPolicy } = await import(
      './output-security-policy.mts'
    )
    const { logger } = await vi.importMock('@socketsecurity/lib/logger')
    const { mdTableOfPairs } = await vi.importMock(
      '../../utils/output/markdown.mts',
    )
    const mockLog = vi.mocked(logger.log)
    const mockTable = vi.mocked(mdTableOfPairs)

    const result: CResult<
      SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']
    > = createSuccessResult({
      securityPolicyDefault: 'monitor',
      securityPolicyRules: {},
    })

    await outputSecurityPolicy(result, 'text')

    expect(mockLog).toHaveBeenCalledWith(
      'The default security policy setting is: "monitor"',
    )
    expect(mockTable).toHaveBeenCalledWith([], ['name', 'action'])
  })

  it('handles null security policy rules', async () => {
    const { outputSecurityPolicy } = await import(
      './output-security-policy.mts'
    )
    const { mdTableOfPairs } = await vi.importMock(
      '../../utils/output/markdown.mts',
    )
    const mockTable = vi.mocked(mdTableOfPairs)

    const result: CResult<
      SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']
    > = createSuccessResult({
      securityPolicyDefault: 'defer',
      securityPolicyRules: null,
    })

    await outputSecurityPolicy(result, 'text')

    expect(mockTable).toHaveBeenCalledWith([], ['name', 'action'])
  })

  it('sorts policy rules alphabetically', async () => {
    const { outputSecurityPolicy } = await import(
      './output-security-policy.mts'
    )
    const { mdTableOfPairs } = await vi.importMock(
      '../../utils/output/markdown.mts',
    )
    const mockTable = vi.mocked(mdTableOfPairs)

    const result: CResult<
      SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']
    > = createSuccessResult({
      securityPolicyDefault: 'warn',
      securityPolicyRules: {
        zlib: { action: 'ignore' },
        attackVector: { action: 'error' },
        malware: { action: 'warn' },
      },
    })

    await outputSecurityPolicy(result, 'text')

    // Verify the entries are sorted alphabetically.
    expect(mockTable).toHaveBeenCalledWith(
      [
        ['attackVector', 'error'],
        ['malware', 'warn'],
        ['zlib', 'ignore'],
      ],
      ['name', 'action'],
    )
  })

  it('sets default exit code when code is undefined', async () => {
    const { outputSecurityPolicy } = await import(
      './output-security-policy.mts'
    )
    const result: CResult<
      SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']
    > = createErrorResult('Error without code')

    await outputSecurityPolicy(result, 'json')

    expect(process.exitCode).toBe(1)
  })
})
