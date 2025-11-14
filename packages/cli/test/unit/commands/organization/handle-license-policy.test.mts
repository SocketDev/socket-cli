/**
 * Unit Tests: Organization License Policy Command Handler
 *
 * Purpose:
 * Tests the command handler that orchestrates fetching and displaying organization license
 * policy configuration. Validates organization slug forwarding, output format selection,
 * and error propagation through the fetch/output pipeline.
 *
 * Test Coverage:
 * - Successful license policy fetch and output
 * - Fetch error handling and propagation
 * - Multiple output format support (json, text, markdown)
 * - Organization slug parameter passing
 *
 * Testing Approach:
 * Mocks fetchLicensePolicy and outputLicensePolicy modules to test orchestration logic
 * without actual API calls or terminal output. Uses test helpers for CResult pattern validation.
 *
 * Related Files:
 * - src/commands/organization/handle-license-policy.mts - Command handler
 * - src/commands/organization/fetch-license-policy.mts - License policy fetcher
 * - src/commands/organization/output-license-policy.mts - Output formatter
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchLicensePolicy } from '../../../../src/commands/organization/fetch-license-policy.mts'
import { handleLicensePolicy } from '../../../../src/commands/organization/handle-license-policy.mts'
import { outputLicensePolicy } from '../../../../src/commands/organization/output-license-policy.mts'
import {
  createErrorResult,
  createSuccessResult,
} from '../../../helpers/mocks.mts'

// Mock the dependencies.
const mockFetchLicensePolicy = vi.hoisted(() => vi.fn())
const mockOutputLicensePolicy = vi.hoisted(() => vi.fn())

vi.mock(
  '../../../../src/commands/organization/fetch-license-policy.mts',
  () => ({
    fetchLicensePolicy: mockFetchLicensePolicy,
  }),
)

vi.mock(
  '../../../../src/commands/organization/output-license-policy.mts',
  () => ({
    outputLicensePolicy: mockOutputLicensePolicy,
  }),
)

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

    expect(fetchLicensePolicy).toHaveBeenCalledWith('test-org', {
      commandPath: 'socket organization policy license',
    })
    expect(outputLicensePolicy).toHaveBeenCalledWith(mockResult, 'json')
  })

  it('handles failed license policy fetch', async () => {
    const mockResult = createErrorResult('Unauthorized')
    mockFetchLicensePolicy.mockResolvedValue(mockResult)

    await handleLicensePolicy('test-org', 'text')

    expect(fetchLicensePolicy).toHaveBeenCalledWith('test-org', {
      commandPath: 'socket organization policy license',
    })
    expect(outputLicensePolicy).toHaveBeenCalledWith(mockResult, 'text')
  })

  it('handles markdown output format', async () => {
    mockFetchLicensePolicy.mockResolvedValue(createSuccessResult({}))

    await handleLicensePolicy('test-org', 'markdown')

    expect(outputLicensePolicy).toHaveBeenCalledWith(
      expect.any(Object),
      'markdown',
    )
  })
})
