import { describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../../src/helpers/mocks.mts'
import { handleLicensePolicy } from '../../../../../src/commands/organization/handle-license-policy.mts'

// Mock the dependencies.

vi.mock('../../../../../src/commands/organization/fetch-license-policy.mts', () => ({
  fetchLicensePolicy: vi.fn(),
}))

vi.mock('../../../../../src/commands/organization/output-license-policy.mts', () => ({
  outputLicensePolicy: vi.fn(),
}))

describe('handleLicensePolicy', () => {
  it('handles successful license policy fetch', async () => {
    const { fetchLicensePolicy } = await import('../../src/fetch-license-policy.mts')
    const { outputLicensePolicy } = await import('../../src/output-license-policy.mts')
    const mockFetch = vi.mocked(fetchLicensePolicy)
    const mockOutput = vi.mocked(outputLicensePolicy)

    const mockResult = createSuccessResult({
      allowed: ['MIT', 'Apache-2.0', 'BSD-3-Clause'],
      denied: ['GPL-3.0', 'AGPL-3.0'],
    })
    mockFetch.mockResolvedValue(mockResult)

    await handleLicensePolicy('test-org', 'json')

    expect(mockFetch).toHaveBeenCalledWith('test-org')
    expect(mockOutput).toHaveBeenCalledWith(mockResult, 'json')
  })

  it('handles failed license policy fetch', async () => {
    const { fetchLicensePolicy } = await import('../../src/fetch-license-policy.mts')
    const { outputLicensePolicy } = await import('../../src/output-license-policy.mts')
    const mockFetch = vi.mocked(fetchLicensePolicy)
    const mockOutput = vi.mocked(outputLicensePolicy)

    const mockResult = createErrorResult('Unauthorized')
    mockFetch.mockResolvedValue(mockResult)

    await handleLicensePolicy('test-org', 'text')

    expect(mockFetch).toHaveBeenCalledWith('test-org')
    expect(mockOutput).toHaveBeenCalledWith(mockResult, 'text')
  })

  it('handles markdown output format', async () => {
    const { fetchLicensePolicy } = await import('../../src/fetch-license-policy.mts')
    const { outputLicensePolicy } = await import('../../src/output-license-policy.mts')
    const mockFetch = vi.mocked(fetchLicensePolicy)
    const mockOutput = vi.mocked(outputLicensePolicy)

    mockFetch.mockResolvedValue(createSuccessResult({}))

    await handleLicensePolicy('test-org', 'markdown')

    expect(mockOutput).toHaveBeenCalledWith(expect.any(Object), 'markdown')
  })
})
