import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../helpers/mocks.mts'
import { handleLicensePolicy } from '../../../../src/commands/organization/handle-license-policy.mts'
import { fetchLicensePolicy } from '../../../../src/commands/organization/fetch-license-policy.mts'
import { outputLicensePolicy } from '../../../../src/commands/organization/output-license-policy.mts'

// Mock the dependencies.
const mockFetchLicensePolicy = vi.hoisted(() => vi.fn())
const mockOutputLicensePolicy = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/commands/organization/fetch-license-policy.mts', () => ({
  fetchLicensePolicy: mockFetchLicensePolicy,
}))

vi.mock('../../../../src/commands/organization/output-license-policy.mts', () => ({
  outputLicensePolicy: mockOutputLicensePolicy,
}))

describe('handleLicensePolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('handles successful license policy fetch', async () => {
    const mockResult = createSuccessResult({
      allowed: ['MIT', 'Apache-2.0', 'BSD-3-Clause'],
      denied: ['GPL-3.0', 'AGPL-3.0'],
    })
    mockFetchLicensePolicy.mockResolvedValue(mockResult)

    await handleLicensePolicy('test-org', 'json')

    expect(fetchLicensePolicy).toHaveBeenCalledWith('test-org')
    expect(outputLicensePolicy).toHaveBeenCalledWith(mockResult, 'json')
  })

  it('handles failed license policy fetch', async () => {
    const mockResult = createErrorResult('Unauthorized')
    mockFetchLicensePolicy.mockResolvedValue(mockResult)

    await handleLicensePolicy('test-org', 'text')

    expect(fetchLicensePolicy).toHaveBeenCalledWith('test-org')
    expect(outputLicensePolicy).toHaveBeenCalledWith(mockResult, 'text')
  })

  it('handles markdown output format', async () => {
    mockFetchLicensePolicy.mockResolvedValue(createSuccessResult({}))

    await handleLicensePolicy('test-org', 'markdown')

    expect(outputLicensePolicy).toHaveBeenCalledWith(expect.any(Object), 'markdown')
  })
})
