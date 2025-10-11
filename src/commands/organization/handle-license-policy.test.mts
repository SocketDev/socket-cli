import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleLicensePolicy } from './handle-license-policy.mts'

// Mock the dependencies

vi.mock('./fetch-license-policy.mts', () => ({
  fetchLicensePolicy: vi.fn(),
}))

vi.mock('./output-license-policy.mts', () => ({
  outputLicensePolicy: vi.fn(),
}))

describe('handleLicensePolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('handles successful license policy fetch', async () => {
    const { fetchLicensePolicy } = await import('./fetch-license-policy.mts')
    const { outputLicensePolicy } = await import('./output-license-policy.mts')
    const mockFetch = vi.mocked(fetchLicensePolicy)
    const mockOutput = vi.mocked(outputLicensePolicy)

    const mockResult = {
      ok: true,
      data: {
        allowed: ['MIT', 'Apache-2.0', 'BSD-3-Clause'],
        denied: ['GPL-3.0', 'AGPL-3.0'],
      },
    }
    mockFetch.mockResolvedValue(mockResult)

    await handleLicensePolicy('test-org', 'json')

    expect(mockFetch).toHaveBeenCalledWith('test-org')
    expect(mockOutput).toHaveBeenCalledWith(mockResult.data, 'json')
  })

  it('handles failed license policy fetch', async () => {
    const { fetchLicensePolicy } = await import('./fetch-license-policy.mts')
    const { outputLicensePolicy } = await import('./output-license-policy.mts')
    const mockFetch = vi.mocked(fetchLicensePolicy)
    const mockOutput = vi.mocked(outputLicensePolicy)

    const mockResult = {
      ok: false,
      message: 'Unauthorized',
    }
    mockFetch.mockResolvedValue(mockResult)

    await expect(handleLicensePolicy('test-org', 'text')).rejects.toThrow('Unauthorized')

    expect(mockFetch).toHaveBeenCalledWith('test-org')
    expect(mockOutput).not.toHaveBeenCalled()
  })

  it('handles markdown output format', async () => {
    const { fetchLicensePolicy } = await import('./fetch-license-policy.mts')
    const { outputLicensePolicy } = await import('./output-license-policy.mts')
    const mockFetch = vi.mocked(fetchLicensePolicy)
    const mockOutput = vi.mocked(outputLicensePolicy)

    mockFetch.mockResolvedValue({ ok: true, data: {} })

    await handleLicensePolicy('test-org', 'markdown')

    expect(mockOutput).toHaveBeenCalledWith(expect.any(Object), 'markdown')
  })
})
