import { describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../../../src/commands/../../../test/helpers/mocks.mts'
import { handleLicensePolicy } from '../../../../src/src/commands/organization/handle-license-policy.mts'

// Mock the dependencies.

const mockFetchLicensePolicy = vi.hoisted(() => vi.fn())
const mockOutputLicensePolicy = vi.hoisted(() => vi.fn())

vi.mock('../../../../../src/commands/organization/fetch-license-policy.mts', () => ({
  fetchLicensePolicy: mockFetchLicensePolicy,
}))

vi.mock('../../../../../src/commands/organization/output-license-policy.mts', () => ({
  outputLicensePolicy: mockOutputLicensePolicy,
}))

describe('handleLicensePolicy', () => {
  it('handles successful license policy fetch', async () => {
    const { fetchLicensePolicy } = await import('../../../../../src/commands/organization/fetch-license-policy.mts')
    const { outputLicensePolicy } = await import('../../../../../src/commands/organization/output-license-policy.mts')
    const mockFetch = mockFetchLicensePolicy
    const mockOutput = mockOutputLicensePolicy

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
    const { fetchLicensePolicy } = await import('../../../../../src/commands/organization/fetch-license-policy.mts')
    const { outputLicensePolicy } = await import('../../../../../src/commands/organization/output-license-policy.mts')
    const mockFetch = mockFetchLicensePolicy
    const mockOutput = mockOutputLicensePolicy

    const mockResult = createErrorResult('Unauthorized')
    mockFetch.mockResolvedValue(mockResult)

    await handleLicensePolicy('test-org', 'text')

    expect(mockFetch).toHaveBeenCalledWith('test-org')
    expect(mockOutput).toHaveBeenCalledWith(mockResult, 'text')
  })

  it('handles markdown output format', async () => {
    const { fetchLicensePolicy } = await import('../../../../../src/commands/organization/fetch-license-policy.mts')
    const { outputLicensePolicy } = await import('../../../../../src/commands/organization/output-license-policy.mts')
    const mockFetch = mockFetchLicensePolicy
    const mockOutput = mockOutputLicensePolicy

    mockFetch.mockResolvedValue(createSuccessResult({}))

    await handleLicensePolicy('test-org', 'markdown')

    expect(mockOutput).toHaveBeenCalledWith(expect.any(Object), 'markdown')
  })
})
