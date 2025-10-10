import { describe, expect, it, vi } from 'vitest'

import { handleSecurityPolicy } from './handle-security-policy.mts'

// Mock the dependencies
vi.mock('./fetch-security-policy.mts', () => ({
  fetchSecurityPolicy: vi.fn(),
}))

vi.mock('./output-security-policy.mts', () => ({
  outputSecurityPolicy: vi.fn(),
}))

describe('handleSecurityPolicy', () => {
  it('fetches and outputs security policy successfully', async () => {
    const { fetchSecurityPolicy } = await import('./fetch-security-policy.mts')
    const { outputSecurityPolicy } = await import(
      './output-security-policy.mts'
    )
    const mockFetch = vi.mocked(fetchSecurityPolicy)
    const mockOutput = vi.mocked(outputSecurityPolicy)

    const mockPolicy = {
      ok: true,
      data: {
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
      },
    }
    mockFetch.mockResolvedValue(mockPolicy)

    await handleSecurityPolicy('test-org', 'json')

    expect(mockFetch).toHaveBeenCalledWith('test-org')
    expect(mockOutput).toHaveBeenCalledWith(mockPolicy, 'json')
  })

  it('handles fetch failure', async () => {
    const { fetchSecurityPolicy } = await import('./fetch-security-policy.mts')
    const { outputSecurityPolicy } = await import(
      './output-security-policy.mts'
    )
    const mockFetch = vi.mocked(fetchSecurityPolicy)
    const mockOutput = vi.mocked(outputSecurityPolicy)

    const mockError = {
      ok: false,
      error: 'Organization not found',
    }
    mockFetch.mockResolvedValue(mockError)

    await handleSecurityPolicy('invalid-org', 'text')

    expect(mockFetch).toHaveBeenCalledWith('invalid-org')
    expect(mockOutput).toHaveBeenCalledWith(mockError, 'text')
  })

  it('handles markdown output format', async () => {
    const { fetchSecurityPolicy } = await import('./fetch-security-policy.mts')
    const { outputSecurityPolicy } = await import(
      './output-security-policy.mts'
    )
    const mockFetch = vi.mocked(fetchSecurityPolicy)
    const mockOutput = vi.mocked(outputSecurityPolicy)

    mockFetch.mockResolvedValue({ ok: true, data: {} })

    await handleSecurityPolicy('my-org', 'markdown')

    expect(mockOutput).toHaveBeenCalledWith(expect.any(Object), 'markdown')
  })

  it('handles different organization slugs', async () => {
    const { fetchSecurityPolicy } = await import('./fetch-security-policy.mts')
    const mockFetch = vi.mocked(fetchSecurityPolicy)

    const orgSlugs = [
      'org-with-dashes',
      'simple',
      'company_underscore',
      'org123',
    ]

    for (const orgSlug of orgSlugs) {
      mockFetch.mockResolvedValue({ ok: true, data: {} })
      // eslint-disable-next-line no-await-in-loop
      await handleSecurityPolicy(orgSlug, 'json')
      expect(mockFetch).toHaveBeenCalledWith(orgSlug)
    }
  })

  it('handles text output with detailed policy', async () => {
    const { fetchSecurityPolicy } = await import('./fetch-security-policy.mts')
    const { outputSecurityPolicy } = await import(
      './output-security-policy.mts'
    )
    const mockFetch = vi.mocked(fetchSecurityPolicy)
    const mockOutput = vi.mocked(outputSecurityPolicy)

    mockFetch.mockResolvedValue({
      ok: true,
      data: {
        rules: [
          { id: 'rule-1', name: 'CVE check', enabled: true },
          { id: 'rule-2', name: 'Malware scan', enabled: true },
          { id: 'rule-3', name: 'License compliance', enabled: false },
        ],
        lastUpdated: '2025-01-01T00:00:00Z',
      },
    })

    await handleSecurityPolicy('production-org', 'text')

    expect(mockOutput).toHaveBeenCalledWith(
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
