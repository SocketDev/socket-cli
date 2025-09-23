import { beforeEach, describe, expect, it, vi } from 'vitest'

import { outputSecurityPolicy } from './output-security-policy.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

// Mock the dependencies.
vi.mock('@socketsecurity/registry/lib/logger', () => ({
  logger: {
    fail: vi.fn(),
    log: vi.fn(),
  },
}))

vi.mock('../../utils/fail-msg-with-badge.mts', () => ({
  failMsgWithBadge: vi.fn((msg, cause) => `${msg}: ${cause}`),
}))

vi.mock('../../utils/markdown.mts', () => ({
  mdTableOfPairs: vi.fn(pairs => `Table with ${pairs.length} rows`),
}))

vi.mock('../../utils/serialize-result-json.mts', () => ({
  serializeResultJson: vi.fn(result => JSON.stringify(result)),
}))

describe('outputSecurityPolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  it('outputs JSON format for successful result', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const { serializeResultJson } = await import(
      '../../utils/serialize-result-json.mts'
    )
    const mockLog = vi.mocked(logger.log)
    const mockSerialize = vi.mocked(serializeResultJson)

    const result: CResult<
      SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']
    > = {
      ok: true,
      data: {
        securityPolicyDefault: 'warn',
        securityPolicyRules: {
          malware: { action: 'error' },
          typosquatting: { action: 'warn' },
          telemetry: { action: 'ignore' },
        },
      },
    }

    await outputSecurityPolicy(result, 'json')

    expect(mockSerialize).toHaveBeenCalledWith(result)
    expect(mockLog).toHaveBeenCalledWith(JSON.stringify(result))
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in JSON format', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockLog = vi.mocked(logger.log)

    const result: CResult<
      SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']
    > = {
      ok: false,
      code: 2,
      message: 'Unauthorized',
      cause: 'Invalid API token',
    }

    await outputSecurityPolicy(result, 'json')

    expect(mockLog).toHaveBeenCalled()
    expect(process.exitCode).toBe(2)
  })

  it('outputs text format with security policy table', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const { mdTableOfPairs } = await import('../../utils/markdown.mts')
    const mockLog = vi.mocked(logger.log)
    const mockTable = vi.mocked(mdTableOfPairs)

    const result: CResult<
      SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']
    > = {
      ok: true,
      data: {
        securityPolicyDefault: 'error',
        securityPolicyRules: {
          dynamicRequire: { action: 'warn' },
          malware: { action: 'error' },
          networkAccess: { action: 'defer' },
        },
      },
    }

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
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const { failMsgWithBadge } = await import(
      '../../utils/fail-msg-with-badge.mts'
    )
    const mockFail = vi.mocked(logger.fail)
    const mockFailMsg = vi.mocked(failMsgWithBadge)

    const result: CResult<
      SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']
    > = {
      ok: false,
      code: 1,
      message: 'Failed to fetch security policy',
      cause: 'Network error',
    }

    await outputSecurityPolicy(result, 'text')

    expect(mockFailMsg).toHaveBeenCalledWith(
      'Failed to fetch security policy',
      'Network error',
    )
    expect(mockFail).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('handles empty security policy rules', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const { mdTableOfPairs } = await import('../../utils/markdown.mts')
    const mockLog = vi.mocked(logger.log)
    const mockTable = vi.mocked(mdTableOfPairs)

    const result: CResult<
      SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']
    > = {
      ok: true,
      data: {
        securityPolicyDefault: 'monitor',
        securityPolicyRules: {},
      },
    }

    await outputSecurityPolicy(result, 'text')

    expect(mockLog).toHaveBeenCalledWith(
      'The default security policy setting is: "monitor"',
    )
    expect(mockTable).toHaveBeenCalledWith([], ['name', 'action'])
  })

  it('handles null security policy rules', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const { mdTableOfPairs } = await import('../../utils/markdown.mts')
    const mockTable = vi.mocked(mdTableOfPairs)

    const result: CResult<
      SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']
    > = {
      ok: true,
      data: {
        securityPolicyDefault: 'defer',
        securityPolicyRules: null,
      },
    }

    await outputSecurityPolicy(result, 'text')

    expect(mockTable).toHaveBeenCalledWith([], ['name', 'action'])
  })

  it('sorts policy rules alphabetically', async () => {
    const { mdTableOfPairs } = await import('../../utils/markdown.mts')
    const mockTable = vi.mocked(mdTableOfPairs)

    const result: CResult<
      SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']
    > = {
      ok: true,
      data: {
        securityPolicyDefault: 'warn',
        securityPolicyRules: {
          zlib: { action: 'ignore' },
          attackVector: { action: 'error' },
          malware: { action: 'warn' },
        },
      },
    }

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
    const result: CResult<
      SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']
    > = {
      ok: false,
      message: 'Error without code',
    }

    await outputSecurityPolicy(result, 'json')

    expect(process.exitCode).toBe(1)
  })
})
