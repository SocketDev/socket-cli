import { describe, expect, it, vi } from 'vitest'

import { handleLicensePolicy } from './handle-license-policy.mts'

// Mock the dependencies.
vi.mock('@socketsecurity/registry/lib/debug', () => ({
  debugDir: vi.fn(),
  debugFn: vi.fn(),
}))

vi.mock('./fetch-license-policy.mts', () => ({
  fetchLicensePolicy: vi.fn(),
}))

vi.mock('./output-license-policy.mts', () => ({
  outputLicensePolicy: vi.fn(),
}))

describe('handleLicensePolicy', () => {
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

    await handleLicensePolicy({
      outputKind: 'json',
    })

    expect(mockFetch).toHaveBeenCalled()
    expect(mockOutput).toHaveBeenCalledWith(mockResult, {
      outputKind: 'json',
    })
  })

  it('handles failed license policy fetch', async () => {
    const { fetchLicensePolicy } = await import('./fetch-license-policy.mts')
    const { outputLicensePolicy } = await import('./output-license-policy.mts')
    const mockFetch = vi.mocked(fetchLicensePolicy)
    const mockOutput = vi.mocked(outputLicensePolicy)

    const mockResult = {
      ok: false,
      error: 'Unauthorized',
    }
    mockFetch.mockResolvedValue(mockResult)

    await handleLicensePolicy({
      outputKind: 'text',
    })

    expect(mockFetch).toHaveBeenCalled()
    expect(mockOutput).toHaveBeenCalledWith(mockResult, {
      outputKind: 'text',
    })
  })

  it('handles markdown output format', async () => {
    const { fetchLicensePolicy } = await import('./fetch-license-policy.mts')
    const { outputLicensePolicy } = await import('./output-license-policy.mts')
    const mockFetch = vi.mocked(fetchLicensePolicy)
    const mockOutput = vi.mocked(outputLicensePolicy)

    mockFetch.mockResolvedValue({ ok: true, data: {} })

    await handleLicensePolicy({
      outputKind: 'markdown',
    })

    expect(mockOutput).toHaveBeenCalledWith(
      expect.any(Object),
      { outputKind: 'markdown' },
    )
  })
})