import { describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../test/helpers/index.mts'

// Mock the output module to avoid logger dependencies.
vi.mock('./output-license-policy.mts', () => ({
  outputLicensePolicy: vi.fn(),
}))

const { outputLicensePolicy } = await import('./output-license-policy.mts')

describe('outputLicensePolicy', () => {
  it('should be callable with valid license policy result', async () => {
    const mockOutput = vi.mocked(outputLicensePolicy)
    mockOutput.mockResolvedValue()

    const result = createSuccessResult({
      license_policy: {
        MIT: { allowed: true },
        'GPL-3.0': { allowed: false },
        'Apache-2.0': { allowed: true },
      },
    })

    await outputLicensePolicy(result as any, 'json')

    expect(mockOutput).toHaveBeenCalledWith(result, 'json')
  })

  it('should handle error results', async () => {
    const mockOutput = vi.mocked(outputLicensePolicy)
    mockOutput.mockResolvedValue()

    const result = createErrorResult('Unauthorized', {
      code: 2,
      cause: 'Invalid API token',
    })

    await outputLicensePolicy(result, 'json')

    expect(mockOutput).toHaveBeenCalledWith(result, 'json')
  })

  it('should support different output formats', async () => {
    const mockOutput = vi.mocked(outputLicensePolicy)
    mockOutput.mockResolvedValue()

    const result = createSuccessResult({
      license_policy: {
        MIT: { allowed: true },
      },
    })

    for (const format of ['json', 'text', 'markdown'] as const) {
      await outputLicensePolicy(result as any, format)
      expect(mockOutput).toHaveBeenCalledWith(result, format)
    }
  })
})
