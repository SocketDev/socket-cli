import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handlePurlsShallowScore } from '../../../../src/src/commands/package/handle-purls-shallow-score.mts'
import { fetchPurlsShallowScore } from '../../../../src/src/commands/package/fetch-purls-shallow-score.mts'
import { outputPurlsShallowScore } from '../../../../src/src/commands/package/output-purls-shallow-score.mts'
import { debug, debugDir } from '@socketsecurity/lib/debug'

// Mock the dependencies.
const mockFetchPurlsShallowScore = vi.hoisted(() => vi.fn())
const mockOutputPurlsShallowScore = vi.hoisted(() => vi.fn())
const mock_debug = vi.hoisted(() => vi.fn())
const mockDebug = vi.hoisted(() => vi.fn())
const mockDebugDir = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/commands/package/fetch-purls-shallow-score.mts', () => ({
  fetchPurlsShallowScore: mockFetchPurlsShallowScore,
}))
vi.mock('../../../../src/commands/package/output-purls-shallow-score.mts', () => ({
  outputPurlsShallowScore: mockOutputPurlsShallowScore,
}))
vi.mock('@socketsecurity/lib/debug', () => ({
  _debug: mock_debug,
  debug: mockDebug,
  debugDir: mockDebugDir,
}))

describe('handlePurlsShallowScore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches and outputs shallow scores successfully', async () => {
    const mockData = {
      ok: true,
      data: [
        { name: 'package1', version: '1.0.0', score: 85 },
        { name: 'package2', version: '2.0.0', score: 92 },
      ],
    }
    mockFetchPurlsShallowScore.mockResolvedValue(mockData)

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
    const mockError = {
      ok: false,
      error: new Error('Failed to fetch scores'),
    }
    mockFetchPurlsShallowScore.mockResolvedValue(mockError)

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
    const mockData = {
      ok: true,
      data: [{ name: 'package1', version: '1.0.0', score: 90 }],
    }
    mockFetchPurlsShallowScore.mockResolvedValue(mockData)

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
    const mockData = {
      ok: true,
      data: [],
    }
    mockFetchPurlsShallowScore.mockResolvedValue(mockData)

    await handlePurlsShallowScore({
      outputKind: 'json',
      purls: [],
    })

    expect(fetchPurlsShallowScore).toHaveBeenCalledWith([])
    expect(outputPurlsShallowScore).toHaveBeenCalledWith([], mockData, 'json')
  })

  it('logs debug information', async () => {
    const mockData = {
      ok: true,
      data: [{ name: 'package1', version: '1.0.0', score: 88 }],
    }
    mockFetchPurlsShallowScore.mockResolvedValue(mockData)

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
    const mockError = {
      ok: false,
      error: new Error('API error'),
    }
    mockFetchPurlsShallowScore.mockResolvedValue(mockError)

    await handlePurlsShallowScore({
      outputKind: 'json',
      purls: ['pkg:npm/package1@1.0.0'],
    })

    expect(debug).toHaveBeenCalledWith('Shallow scores fetch failed')
  })

  it('handles multiple purls', async () => {
    const mockData = {
      ok: true,
      data: [
        { name: 'package1', version: '1.0.0', score: 85 },
        { name: 'package2', version: '2.0.0', score: 92 },
        { name: 'package3', version: '3.0.0', score: 78 },
      ],
    }
    mockFetchPurlsShallowScore.mockResolvedValue(mockData)

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
