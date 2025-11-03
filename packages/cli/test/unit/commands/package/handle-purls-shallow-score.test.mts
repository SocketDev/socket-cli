import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handlePurlsShallowScore } from '../../../../src/src/handle-purls-shallow-score.mts'

// Mock the dependencies.
vi.mock('./fetch-purls-shallow-score.mts', () => ({
  fetchPurlsShallowScore: vi.fn(),
}))
vi.mock('./output-purls-shallow-score.mts', () => ({
  outputPurlsShallowScore: vi.fn(),
}))
vi.mock('@socketsecurity/lib/debug', () => ({
  _debug: vi.fn(),
  debug: vi.fn(),
  debugDir: vi.fn(),
}))

describe('handlePurlsShallowScore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches and outputs shallow scores successfully', async () => {
    const { fetchPurlsShallowScore } = await import(
      './fetch-purls-shallow-score.mts'
    )
    const { outputPurlsShallowScore } = await import(
      './output-purls-shallow-score.mts'
    )

    const mockData = {
      ok: true,
      data: [
        { name: 'package1', version: '1.0.0', score: 85 },
        { name: 'package2', version: '2.0.0', score: 92 },
      ],
    }
    vi.mocked(fetchPurlsShallowScore).mockResolvedValue(mockData)

    const purls = ['pkg:npm/package1@1.0.0', 'pkg:npm/package2@2.0.0']
    await handlePurlsShallowScore({
      outputKind: 'json',
      purls,
    })

    expect(fetchPurlsShallowScore).toHaveBeenCalledWith(purls)
    expect(outputPurlsShallowScore).toHaveBeenCalledWith(
      purls,
      mockData,
      'json',
    )
  })

  it('handles fetch failure', async () => {
    const { fetchPurlsShallowScore } = await import(
      './fetch-purls-shallow-score.mts'
    )
    const { outputPurlsShallowScore } = await import(
      './output-purls-shallow-score.mts'
    )

    const mockError = {
      ok: false,
      error: new Error('Failed to fetch scores'),
    }
    vi.mocked(fetchPurlsShallowScore).mockResolvedValue(mockError)

    const purls = ['pkg:npm/package1@1.0.0']
    await handlePurlsShallowScore({
      outputKind: 'text',
      purls,
    })

    expect(fetchPurlsShallowScore).toHaveBeenCalledWith(purls)
    expect(outputPurlsShallowScore).toHaveBeenCalledWith(
      purls,
      mockError,
      'text',
    )
  })

  it('handles markdown output', async () => {
    const { fetchPurlsShallowScore } = await import(
      './fetch-purls-shallow-score.mts'
    )
    const { outputPurlsShallowScore } = await import(
      './output-purls-shallow-score.mts'
    )

    const mockData = {
      ok: true,
      data: [{ name: 'package1', version: '1.0.0', score: 90 }],
    }
    vi.mocked(fetchPurlsShallowScore).mockResolvedValue(mockData)

    const purls = ['pkg:npm/package1@1.0.0']
    await handlePurlsShallowScore({
      outputKind: 'markdown',
      purls,
    })

    expect(outputPurlsShallowScore).toHaveBeenCalledWith(
      purls,
      mockData,
      'markdown',
    )
  })

  it('handles empty purls array', async () => {
    const { fetchPurlsShallowScore } = await import(
      './fetch-purls-shallow-score.mts'
    )
    const { outputPurlsShallowScore } = await import(
      './output-purls-shallow-score.mts'
    )

    const mockData = {
      ok: true,
      data: [],
    }
    vi.mocked(fetchPurlsShallowScore).mockResolvedValue(mockData)

    await handlePurlsShallowScore({
      outputKind: 'json',
      purls: [],
    })

    expect(fetchPurlsShallowScore).toHaveBeenCalledWith([])
    expect(outputPurlsShallowScore).toHaveBeenCalledWith([], mockData, 'json')
  })

  it('logs debug information', async () => {
    const { debug, debugDir } = await import('@socketsecurity/lib/debug')
    const { fetchPurlsShallowScore } = await import(
      './fetch-purls-shallow-score.mts'
    )

    const mockData = {
      ok: true,
      data: [{ name: 'package1', version: '1.0.0', score: 88 }],
    }
    vi.mocked(fetchPurlsShallowScore).mockResolvedValue(mockData)

    const purls = ['pkg:npm/package1@1.0.0']
    await handlePurlsShallowScore({
      outputKind: 'json',
      purls,
    })

    expect(debug).toHaveBeenCalledWith('Fetching shallow scores for 1 packages')
    expect(debugDir).toHaveBeenCalledWith({
      purls,
      outputKind: 'json',
    })
    expect(debug).toHaveBeenCalledWith('Shallow scores fetched successfully')
    expect(debugDir).toHaveBeenCalledWith({ packageData: mockData })
  })

  it('logs debug information on failure', async () => {
    const { debug } = await import('@socketsecurity/lib/debug')
    const { fetchPurlsShallowScore } = await import(
      './fetch-purls-shallow-score.mts'
    )

    const mockError = {
      ok: false,
      error: new Error('API error'),
    }
    vi.mocked(fetchPurlsShallowScore).mockResolvedValue(mockError)

    await handlePurlsShallowScore({
      outputKind: 'json',
      purls: ['pkg:npm/package1@1.0.0'],
    })

    expect(debug).toHaveBeenCalledWith('Shallow scores fetch failed')
  })

  it('handles multiple purls', async () => {
    const { fetchPurlsShallowScore } = await import(
      './fetch-purls-shallow-score.mts'
    )
    const { outputPurlsShallowScore } = await import(
      './output-purls-shallow-score.mts'
    )

    const mockData = {
      ok: true,
      data: [
        { name: 'package1', version: '1.0.0', score: 85 },
        { name: 'package2', version: '2.0.0', score: 92 },
        { name: 'package3', version: '3.0.0', score: 78 },
      ],
    }
    vi.mocked(fetchPurlsShallowScore).mockResolvedValue(mockData)

    const purls = [
      'pkg:npm/package1@1.0.0',
      'pkg:npm/package2@2.0.0',
      'pkg:npm/package3@3.0.0',
    ]
    await handlePurlsShallowScore({
      outputKind: 'json',
      purls,
    })

    expect(fetchPurlsShallowScore).toHaveBeenCalledWith(purls)
    expect(outputPurlsShallowScore).toHaveBeenCalledWith(
      purls,
      mockData,
      'json',
    )
  })
})
