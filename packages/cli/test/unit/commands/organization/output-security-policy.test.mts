import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../../src/helpers/index.mts'

import type { CResult } from '../../../../src/types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

describe('outputSecurityPolicy', () => {
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

    vi.doMock('../../utils/output/result-json.mjs', () => ({
      serializeResultJson: mockSerializeResultJson,
    }))

    const { outputSecurityPolicy } = await import(
      './output-security-policy.mts'
    )

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

    vi.doMock('../../utils/output/result-json.mjs', () => ({
      serializeResultJson: mockSerializeResultJson,
    }))

    const { outputSecurityPolicy } = await import(
      './output-security-policy.mts'
    )

    const result: CResult<
      SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']
    > = createErrorResult('Unauthorized', {
      cause: 'Invalid API token',
      code: 2,
    })

    await outputSecurityPolicy(result, 'json')

    expect(mockLogger.log).toHaveBeenCalled()
    expect(process.exitCode).toBe(2)
  })

  it('outputs text format with security policy table', async () => {
    const mockLogger = {
      fail: vi.fn(),
      log: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const mockMdHeader = vi.fn(title => `# ${title}`)
    const mockMdTableOfPairs = vi.fn(pairs => `Table with ${pairs.length} rows`)

    vi.doMock('@socketsecurity/lib/logger', () => ({
      getDefaultLogger: () => mockLogger,
    }))

    vi.doMock('../../utils/output/markdown.mts', () => ({
      mdHeader: mockMdHeader,
      mdTableOfPairs: mockMdTableOfPairs,
    }))

    const { outputSecurityPolicy } = await import(
      './output-security-policy.mts'
    )

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

    expect(mockLogger.log).toHaveBeenCalledWith('# Security policy')
    expect(mockLogger.log).toHaveBeenCalledWith('')
    expect(mockLogger.log).toHaveBeenCalledWith(
      'The default security policy setting is: "error"',
    )
    expect(mockLogger.log).toHaveBeenCalledWith(
      'These are the security policies per setting for your organization:',
    )
    expect(mockMdTableOfPairs).toHaveBeenCalledWith(
      expect.arrayContaining([
        ['dynamicRequire', 'warn'],
        ['malware', 'error'],
        ['networkAccess', 'defer'],
      ]),
      ['name', 'action'],
    )
  })

  it('outputs error in text format', async () => {
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

    vi.doMock('../../utils/error/fail-msg-with-badge.mts', () => ({
      failMsgWithBadge: mockFailMsgWithBadge,
    }))

    const { outputSecurityPolicy } = await import(
      './output-security-policy.mts'
    )

    const result: CResult<
      SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']
    > = createErrorResult('Failed to fetch security policy', {
      cause: 'Network error',
      code: 1,
    })

    await outputSecurityPolicy(result, 'text')

    expect(mockFailMsgWithBadge).toHaveBeenCalledWith(
      'Failed to fetch security policy',
      'Network error',
    )
    expect(mockLogger.fail).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('handles empty security policy rules', async () => {
    const mockLogger = {
      fail: vi.fn(),
      log: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const mockMdHeader = vi.fn(title => `# ${title}`)
    const mockMdTableOfPairs = vi.fn(pairs => `Table with ${pairs.length} rows`)

    vi.doMock('@socketsecurity/lib/logger', () => ({
      getDefaultLogger: () => mockLogger,
    }))

    vi.doMock('../../utils/output/markdown.mts', () => ({
      mdHeader: mockMdHeader,
      mdTableOfPairs: mockMdTableOfPairs,
    }))

    const { outputSecurityPolicy } = await import(
      './output-security-policy.mts'
    )

    const result: CResult<
      SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']
    > = createSuccessResult({
      securityPolicyDefault: 'monitor',
      securityPolicyRules: {},
    })

    await outputSecurityPolicy(result, 'text')

    expect(mockLogger.log).toHaveBeenCalledWith(
      'The default security policy setting is: "monitor"',
    )
    expect(mockMdTableOfPairs).toHaveBeenCalledWith([], ['name', 'action'])
  })

  it('handles null security policy rules', async () => {
    const mockLogger = {
      fail: vi.fn(),
      log: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const mockMdHeader = vi.fn(title => `# ${title}`)
    const mockMdTableOfPairs = vi.fn(pairs => `Table with ${pairs.length} rows`)

    vi.doMock('@socketsecurity/lib/logger', () => ({
      getDefaultLogger: () => mockLogger,
    }))

    vi.doMock('../../utils/output/markdown.mts', () => ({
      mdHeader: mockMdHeader,
      mdTableOfPairs: mockMdTableOfPairs,
    }))

    const { outputSecurityPolicy } = await import(
      './output-security-policy.mts'
    )

    const result: CResult<
      SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']
    > = createSuccessResult({
      securityPolicyDefault: 'defer',
      securityPolicyRules: null,
    })

    await outputSecurityPolicy(result, 'text')

    expect(mockMdTableOfPairs).toHaveBeenCalledWith([], ['name', 'action'])
  })

  it('sorts policy rules alphabetically', async () => {
    const mockLogger = {
      fail: vi.fn(),
      log: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const mockMdHeader = vi.fn(title => `# ${title}`)
    const mockMdTableOfPairs = vi.fn(pairs => `Table with ${pairs.length} rows`)

    vi.doMock('@socketsecurity/lib/logger', () => ({
      getDefaultLogger: () => mockLogger,
    }))

    vi.doMock('../../utils/output/markdown.mts', () => ({
      mdHeader: mockMdHeader,
      mdTableOfPairs: mockMdTableOfPairs,
    }))

    const { outputSecurityPolicy } = await import(
      './output-security-policy.mts'
    )

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
    expect(mockMdTableOfPairs).toHaveBeenCalledWith(
      [
        ['attackVector', 'error'],
        ['malware', 'warn'],
        ['zlib', 'ignore'],
      ],
      ['name', 'action'],
    )
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

    vi.doMock('../../utils/output/result-json.mjs', () => ({
      serializeResultJson: mockSerializeResultJson,
    }))

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
