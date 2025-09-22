import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handlePurlDeepScore } from './handle-purl-deep-score.mts'

// Mock the dependencies.
vi.mock('@socketsecurity/registry/lib/debug', () => ({
  debugDir: vi.fn(),
  debugFn: vi.fn(),
}))
vi.mock('./fetch-purl-deep-score.mts', () => ({
  fetchPurlDeepScore: vi.fn(),
}))
vi.mock('./output-purls-deep-score.mts', () => ({
  outputPurlsDeepScore: vi.fn(),
}))

describe('handlePurlDeepScore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches and outputs deep score successfully', async () => {
    const { fetchPurlDeepScore } = await import('./fetch-purl-deep-score.mts')
    const { outputPurlsDeepScore } = await import('./output-purls-deep-score.mts')

    const mockData = {
      ok: true,
      data: {
        name: 'package1',
        version: '1.0.0',
        score: 95,
        dependencies: ['dep1', 'dep2'],
      },
    }
    vi.mocked(fetchPurlDeepScore).mockResolvedValue(mockData)

    const purl = 'pkg:npm/package1@1.0.0'
    await handlePurlDeepScore(purl, 'json')

    expect(fetchPurlDeepScore).toHaveBeenCalledWith(purl)
    expect(outputPurlsDeepScore).toHaveBeenCalledWith(purl, mockData, 'json')
  })

  it('handles fetch failure', async () => {
    const { fetchPurlDeepScore } = await import('./fetch-purl-deep-score.mts')
    const { outputPurlsDeepScore } = await import('./output-purls-deep-score.mts')

    const mockError = {
      ok: false,
      error: new Error('Failed to fetch deep score'),
    }
    vi.mocked(fetchPurlDeepScore).mockResolvedValue(mockError)

    const purl = 'pkg:npm/package1@1.0.0'
    await handlePurlDeepScore(purl, 'text')

    expect(fetchPurlDeepScore).toHaveBeenCalledWith(purl)
    expect(outputPurlsDeepScore).toHaveBeenCalledWith(purl, mockError, 'text')
  })

  it('handles markdown output', async () => {
    const { fetchPurlDeepScore } = await import('./fetch-purl-deep-score.mts')
    const { outputPurlsDeepScore } = await import('./output-purls-deep-score.mts')

    const mockData = {
      ok: true,
      data: {
        name: 'package1',
        version: '1.0.0',
        score: 88,
      },
    }
    vi.mocked(fetchPurlDeepScore).mockResolvedValue(mockData)

    const purl = 'pkg:npm/package1@1.0.0'
    await handlePurlDeepScore(purl, 'markdown')

    expect(outputPurlsDeepScore).toHaveBeenCalledWith(purl, mockData, 'markdown')
  })

  it('logs debug information', async () => {
    const { debugDir, debugFn } = await import('@socketsecurity/registry/lib/debug')
    const { fetchPurlDeepScore } = await import('./fetch-purl-deep-score.mts')

    const mockData = {
      ok: true,
      data: { name: 'package1', version: '1.0.0', score: 91 },
    }
    vi.mocked(fetchPurlDeepScore).mockResolvedValue(mockData)

    const purl = 'pkg:npm/package1@1.0.0'
    await handlePurlDeepScore(purl, 'json')

    expect(debugFn).toHaveBeenCalledWith('notice', 'Fetching deep score for pkg:npm/package1@1.0.0')
    expect(debugDir).toHaveBeenCalledWith('inspect', {
      purl,
      outputKind: 'json',
    })
    expect(debugFn).toHaveBeenCalledWith('notice', 'Deep score fetched successfully')
    expect(debugDir).toHaveBeenCalledWith('inspect', { result: mockData })
  })

  it('logs debug information on failure', async () => {
    const { debugFn } = await import('@socketsecurity/registry/lib/debug')
    const { fetchPurlDeepScore } = await import('./fetch-purl-deep-score.mts')

    const mockError = {
      ok: false,
      error: new Error('API error'),
    }
    vi.mocked(fetchPurlDeepScore).mockResolvedValue(mockError)

    await handlePurlDeepScore('pkg:npm/package1@1.0.0', 'json')

    expect(debugFn).toHaveBeenCalledWith('notice', 'Deep score fetch failed')
  })

  it('handles different purl formats', async () => {
    const { fetchPurlDeepScore } = await import('./fetch-purl-deep-score.mts')
    const { outputPurlsDeepScore } = await import('./output-purls-deep-score.mts')

    const purls = [
      'pkg:npm/package1@1.0.0',
      'pkg:npm/@scope/package@2.0.0',
      'pkg:npm/package@latest',
    ]

    for (const purl of purls) {
      vi.mocked(fetchPurlDeepScore).mockResolvedValue({
        ok: true,
        data: { name: 'test', version: '1.0.0', score: 85 },
      })

      // eslint-disable-next-line no-await-in-loop
      await handlePurlDeepScore(purl, 'json')

      expect(fetchPurlDeepScore).toHaveBeenCalledWith(purl)
    }
  })

  it('handles text output', async () => {
    const { fetchPurlDeepScore } = await import('./fetch-purl-deep-score.mts')
    const { outputPurlsDeepScore } = await import('./output-purls-deep-score.mts')

    const mockData = {
      ok: true,
      data: {
        name: 'package1',
        version: '1.0.0',
        score: 93,
      },
    }
    vi.mocked(fetchPurlDeepScore).mockResolvedValue(mockData)

    const purl = 'pkg:npm/package1@1.0.0'
    await handlePurlDeepScore(purl, 'text')

    expect(outputPurlsDeepScore).toHaveBeenCalledWith(purl, mockData, 'text')
  })
})