import { describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../test/helpers/index.mts'
import type { CResult } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

// Mock the output module to avoid logger dependencies.
vi.mock('./output-security-policy.mts', () => ({
  outputSecurityPolicy: vi.fn(),
}))

const { outputSecurityPolicy } = await import('./output-security-policy.mts')

describe('outputSecurityPolicy', () => {
  it('should be callable with valid security policy result', async () => {
    const mockOutput = vi.mocked(outputSecurityPolicy)
    mockOutput.mockResolvedValue()

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

    expect(mockOutput).toHaveBeenCalledWith(result, 'json')
  })

  it('should handle error results', async () => {
    const mockOutput = vi.mocked(outputSecurityPolicy)
    mockOutput.mockResolvedValue()

    const result: CResult<
      SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']
    > = createErrorResult('Unauthorized', {
      cause: 'Invalid API token',
      code: 2,
    })

    await outputSecurityPolicy(result, 'json')

    expect(mockOutput).toHaveBeenCalledWith(result, 'json')
  })

  it('should support different output formats', async () => {
    const mockOutput = vi.mocked(outputSecurityPolicy)
    mockOutput.mockResolvedValue()

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

    for (const format of ['json', 'text', 'markdown'] as const) {
      await outputSecurityPolicy(result, format)
      expect(mockOutput).toHaveBeenCalledWith(result, format)
    }
  })

  it('should handle empty security policy rules', async () => {
    const mockOutput = vi.mocked(outputSecurityPolicy)
    mockOutput.mockResolvedValue()

    const result: CResult<
      SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']
    > = createSuccessResult({
      securityPolicyDefault: 'monitor',
      securityPolicyRules: {},
    })

    await outputSecurityPolicy(result, 'text')

    expect(mockOutput).toHaveBeenCalledWith(result, 'text')
  })
})
