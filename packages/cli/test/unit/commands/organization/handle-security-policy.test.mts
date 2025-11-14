/**
 * Unit Tests: Organization Security Policy Command Handler
 *
 * Purpose:
 * Tests the command handler that orchestrates fetching and displaying organization security
 * policy configuration. Validates organization slug forwarding, output format selection,
 * and error propagation through the fetch/output pipeline.
 *
 * Test Coverage:
 * - Successful security policy fetch and output
 * - Fetch error handling and propagation
 * - Multiple output format support (json, text, markdown)
 * - Organization slug parameter passing
 *
 * Testing Approach:
 * Mocks fetchSecurityPolicy and outputSecurityPolicy modules to test orchestration logic
 * without actual API calls or terminal output. Uses test helpers for CResult pattern validation.
 *
 * Related Files:
 * - src/commands/organization/handle-security-policy.mts - Command handler
 * - src/commands/organization/fetch-security-policy.mts - Security policy fetcher
 * - src/commands/organization/output-security-policy.mts - Output formatter
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchSecurityPolicy } from '../../../../src/commands/organization/fetch-security-policy.mts'
import { handleSecurityPolicy } from '../../../../src/commands/organization/handle-security-policy.mts'
import { outputSecurityPolicy } from '../../../../src/commands/organization/output-security-policy.mts'
import {
  createErrorResult,
  createSuccessResult,
} from '../../../helpers/mocks.mts'

// Mock the dependencies.
const mockFetchSecurityPolicy = vi.hoisted(() => vi.fn())
const mockOutputSecurityPolicy = vi.hoisted(() => vi.fn())

vi.mock(
  '../../../../src/commands/organization/fetch-security-policy.mts',
  () => ({
    fetchSecurityPolicy: mockFetchSecurityPolicy,
  }),
)

vi.mock(
  '../../../../src/commands/organization/output-security-policy.mts',
  () => ({
    outputSecurityPolicy: mockOutputSecurityPolicy,
  }),
)

describe('handleSecurityPolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches and outputs security policy successfully', async () => {
    const mockPolicy = createSuccessResult({
      rules: [
        {
          id: 'rule-1',
          name: 'No critical vulnerabilities',
          severity: 'critical',
          action: 'block',
        },
        {
          id: 'rule-2',
          name: 'License check',
          type: 'license',
          allowed: ['MIT', 'Apache-2.0'],
        },
      ],
      enforcementLevel: 'strict',
    })
    mockFetchSecurityPolicy.mockResolvedValue(mockPolicy)

    await handleSecurityPolicy('test-org', 'json')

    expect(fetchSecurityPolicy).toHaveBeenCalledWith('test-org', {
      commandPath: 'socket organization policy security',
    })
    expect(outputSecurityPolicy).toHaveBeenCalledWith(mockPolicy, 'json')
  })

  it('handles fetch failure', async () => {
    const mockError = createErrorResult('Organization not found')
    mockFetchSecurityPolicy.mockResolvedValue(mockError)

    await handleSecurityPolicy('invalid-org', 'text')

    expect(fetchSecurityPolicy).toHaveBeenCalledWith('invalid-org', {
      commandPath: 'socket organization policy security',
    })
    expect(outputSecurityPolicy).toHaveBeenCalledWith(mockError, 'text')
  })

  it('handles markdown output format', async () => {
    mockFetchSecurityPolicy.mockResolvedValue(createSuccessResult({}))

    await handleSecurityPolicy('my-org', 'markdown')

    expect(outputSecurityPolicy).toHaveBeenCalledWith(
      expect.any(Object),
      'markdown',
    )
  })

  it('handles different organization slugs', async () => {
    const orgSlugs = [
      'org-with-dashes',
      'simple',
      'company_underscore',
      'org123',
    ]

    for (const orgSlug of orgSlugs) {
      mockFetchSecurityPolicy.mockResolvedValue(createSuccessResult({}))
      // eslint-disable-next-line no-await-in-loop
      await handleSecurityPolicy(orgSlug, 'json')
      expect(fetchSecurityPolicy).toHaveBeenCalledWith(orgSlug, {
        commandPath: 'socket organization policy security',
      })
    }
  })

  it('handles text output with detailed policy', async () => {
    mockFetchSecurityPolicy.mockResolvedValue(
      createSuccessResult({
        rules: [
          { id: 'rule-1', name: 'CVE check', enabled: true },
          { id: 'rule-2', name: 'Malware scan', enabled: true },
          { id: 'rule-3', name: 'License compliance', enabled: false },
        ],
        lastUpdated: '2025-01-01T00:00:00Z',
      }),
    )

    await handleSecurityPolicy('production-org', 'text')

    expect(outputSecurityPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          rules: expect.arrayContaining([
            expect.objectContaining({ id: 'rule-1' }),
          ]),
        }),
      }),
      'text',
    )
  })
})
