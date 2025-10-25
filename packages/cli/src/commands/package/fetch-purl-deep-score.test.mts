import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../test/helpers/mocks.mts'

import type { PurlDataResponse } from './fetch-purl-deep-score.mts'

vi.mock('@socketsecurity/lib/logger', () => ({
  logger: {
    info: vi.fn(),
  },
}))

vi.mock('../../utils/socket/api.mjs', () => ({
  queryApiSafeJson: vi.fn(),
}))

describe('fetchPurlDeepScore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches purl deep score successfully', async () => {
    const { fetchPurlDeepScore } = await import('./fetch-purl-deep-score.mts')
    const { queryApiSafeJson } = await vi.importMock('../../utils/socket/api.mjs')
    const mockQueryApi = vi.mocked(queryApiSafeJson)

    const mockData: PurlDataResponse = {
      purl: 'pkg:npm/lodash@4.17.21',
      self: {
        purl: 'pkg:npm/lodash@4.17.21',
        score: {
          license: 95,
          maintenance: 82,
          overall: 85,
          quality: 88,
          supplyChain: 90,
          vulnerability: 80,
        },
        capabilities: [],
        alerts: [],
      },
      transitively: {
        dependencyCount: 0,
        func: 'max',
        score: {
          license: 95,
          maintenance: 82,
          overall: 85,
          quality: 88,
          supplyChain: 90,
          vulnerability: 80,
        },
        lowest: {
          license: 'pkg:npm/lodash@4.17.21',
          maintenance: 'pkg:npm/lodash@4.17.21',
          overall: 'pkg:npm/lodash@4.17.21',
          quality: 'pkg:npm/lodash@4.17.21',
          supplyChain: 'pkg:npm/lodash@4.17.21',
          vulnerability: 'pkg:npm/lodash@4.17.21',
        },
        capabilities: [],
        alerts: [],
      },
    }

    mockQueryApi.mockResolvedValue(createSuccessResult(mockData))

    const result = await fetchPurlDeepScore('pkg:npm/lodash@4.17.21')

    expect(mockQueryApi).toHaveBeenCalledWith(
      'purl/score/pkg%3Anpm%2Flodash%404.17.21',
      'the deep package scores',
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual(mockData)
    }
  })

  it('handles API call failure', async () => {
    const { fetchPurlDeepScore } = await import('./fetch-purl-deep-score.mts')
    const { queryApiSafeJson } = await vi.importMock('../../utils/socket/api.mjs')
    const mockQueryApi = vi.mocked(queryApiSafeJson)

    mockQueryApi.mockResolvedValue(
      createErrorResult('Package not found', { code: 404 }),
    )

    const result = await fetchPurlDeepScore('pkg:npm/nonexistent@1.0.0')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(404)
    }
  })

  it('handles different purl formats', async () => {
    const { fetchPurlDeepScore } = await import('./fetch-purl-deep-score.mts')
    const { queryApiSafeJson } = await vi.importMock('../../utils/socket/api.mjs')
    const mockQueryApi = vi.mocked(queryApiSafeJson)

    mockQueryApi.mockResolvedValue(createSuccessResult({} as PurlDataResponse))

    const purl = 'pkg:npm/lodash@4.17.21'
    await fetchPurlDeepScore(purl)

    expect(mockQueryApi).toHaveBeenCalledWith(
      `purl/score/${encodeURIComponent(purl)}`,
      'the deep package scores',
    )
  })

  it('handles low score packages', async () => {
    const { fetchPurlDeepScore } = await import('./fetch-purl-deep-score.mts')
    const { queryApiSafeJson } = await vi.importMock('../../utils/socket/api.mjs')
    const mockQueryApi = vi.mocked(queryApiSafeJson)

    const lowScoreData: PurlDataResponse = {
      purl: 'pkg:npm/vulnerable@0.1.0',
      self: {
        purl: 'pkg:npm/vulnerable@0.1.0',
        score: {
          license: 20,
          maintenance: 15,
          overall: 25,
          quality: 30,
          supplyChain: 40,
          vulnerability: 10,
        },
        capabilities: ['network', 'filesystem'],
        alerts: [
          {
            name: 'critical-vulnerability',
            severity: 'critical',
            category: 'vulnerability',
            example: 'CVE-2024-0001',
          },
        ],
      },
      transitively: {
        dependencyCount: 5,
        func: 'min',
        score: {
          license: 20,
          maintenance: 15,
          overall: 25,
          quality: 30,
          supplyChain: 40,
          vulnerability: 10,
        },
        lowest: {
          license: 'pkg:npm/bad-license@1.0.0',
          maintenance: 'pkg:npm/unmaintained@0.0.1',
          overall: 'pkg:npm/vulnerable@0.1.0',
          quality: 'pkg:npm/low-quality@2.0.0',
          supplyChain: 'pkg:npm/risky@1.5.0',
          vulnerability: 'pkg:npm/vulnerable@0.1.0',
        },
        capabilities: ['network', 'filesystem', 'shell'],
        alerts: [],
      },
    }

    mockQueryApi.mockResolvedValue(createSuccessResult(lowScoreData))

    const result = await fetchPurlDeepScore('pkg:npm/vulnerable@0.1.0')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.self.score.overall).toBeLessThan(30)
    }
  })
})
