import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handlePurlDeepScore } from '../../../../src/src/commands/package/handle-purl-deep-score.mts'
import { fetchPurlDeepScore } from '../../../../src/src/commands/package/fetch-purl-deep-score.mts'
import { outputPurlsDeepScore } from '../../../../src/src/commands/package/output-purls-deep-score.mts'
import { debug, debugDir } from '@socketsecurity/lib/debug'

// Mock the dependencies.
const mockFetchPurlDeepScore = vi.hoisted(() => vi.fn())
const mockOutputPurlsDeepScore = vi.hoisted(() => vi.fn())
const mockDebug = vi.hoisted(() => vi.fn())
const mockDebugDir = vi.hoisted(() => vi.fn())
const mockIsDebug = vi.hoisted(() => vi.fn(())

vi.mock('../../../../src/commands/package/fetch-purl-deep-score.mts', () => ({
  fetchPurlDeepScore: mockFetchPurlDeepScore,
}))
vi.mock('../../../../src/commands/package/output-purls-deep-score.mts', () => ({
  outputPurlsDeepScore: mockOutputPurlsDeepScore,
}))
vi.mock('@socketsecurity/lib/debug', () => ({
  debug: mockDebug,
  debugDir: mockDebugDir,
  isDebug: mockIsDebug => false),
}))

describe('handlePurlDeepScore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches and outputs deep score successfully', async () => {
    const mockData = {
      ok: true,
      data: {
        name: 'package1',
        version: '1.0.0',
        score: 95,
        dependencies: ['dep1', 'dep2'],
      },
    }
    mockFetchPurlDeepScore.mockResolvedValue(mockData)

    const purl = 'pkg:npm/package1@1.0.0'
    await handlePurlDeepScore(purl, 'json')

    expect(fetchPurlDeepScore).toHaveBeenCalledWith(purl)
    expect(outputPurlsDeepScore).toHaveBeenCalledWith(purl, mockData, 'json')
  })

  it('handles fetch failure', async () => {
    const mockError = {
      ok: false,
      error: new Error('Failed to fetch deep score'),
    }
    mockFetchPurlDeepScore.mockResolvedValue(mockError)

    const purl = 'pkg:npm/package1@1.0.0'
    await handlePurlDeepScore(purl, 'text')

    expect(fetchPurlDeepScore).toHaveBeenCalledWith(purl)
    expect(outputPurlsDeepScore).toHaveBeenCalledWith(purl, mockError, 'text')
  })

  it('handles markdown output', async () => {
    const mockData = {
      ok: true,
      data: {
        name: 'package1',
        version: '1.0.0',
        score: 88,
      },
    }
    mockFetchPurlDeepScore.mockResolvedValue(mockData)

    const purl = 'pkg:npm/package1@1.0.0'
    await handlePurlDeepScore(purl, 'markdown')

    expect(outputPurlsDeepScore).toHaveBeenCalledWith(
      purl,
      mockData,
      'markdown',
    )
  })

  it('logs debug information', async () => {
    const mockData = {
      ok: true,
      data: { name: 'package1', version: '1.0.0', score: 91 },
    }
    mockFetchPurlDeepScore.mockResolvedValue(mockData)

    const purl = 'pkg:npm/package1@1.0.0'
    await handlePurlDeepScore(purl, 'json')

    expect(debug).toHaveBeenCalledWith(
      'Fetching deep score for pkg:npm/package1@1.0.0',
    )
    expect(debugDir).toHaveBeenCalledWith({
      purl,
      outputKind: 'json',
    })
    expect(debug).toHaveBeenCalledWith('Deep score fetched successfully')
    expect(debugDir).toHaveBeenCalledWith({ result: mockData })
  })

  it('logs debug information on failure', async () => {
    const mockError = {
      ok: false,
      error: new Error('API error'),
    }
    mockFetchPurlDeepScore.mockResolvedValue(mockError)

    await handlePurlDeepScore('pkg:npm/package1@1.0.0', 'json')

    expect(debug).toHaveBeenCalledWith('Deep score fetch failed')
  })

  it('handles different purl formats', async () => {
    const purls = [
      'pkg:npm/package1@1.0.0',
      'pkg:npm/@scope/package@2.0.0',
      'pkg:npm/package@latest',
    ]

    for (const purl of purls) {
      mockFetchPurlDeepScore.mockResolvedValue({
        ok: true,
        data: { name: 'test', version: '1.0.0', score: 85 },
      })

      // eslint-disable-next-line no-await-in-loop
      await handlePurlDeepScore(purl, 'json')

      expect(fetchPurlDeepScore).toHaveBeenCalledWith(purl)
    }
  })

  it('handles text output', async () => {
    const mockData = {
      ok: true,
      data: {
        name: 'package1',
        version: '1.0.0',
        score: 93,
      },
    }
    mockFetchPurlDeepScore.mockResolvedValue(mockData)

    const purl = 'pkg:npm/package1@1.0.0'
    await handlePurlDeepScore(purl, 'text')

    expect(outputPurlsDeepScore).toHaveBeenCalledWith(purl, mockData, 'text')
  })
})
