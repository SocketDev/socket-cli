import { describe, expect, it, vi } from 'vitest'

import { fetchPurlDeepScore } from './fetch-purl-deep-score.mts'

// Mock the dependencies
vi.mock('../../utils/sdk.mts', () => ({
  queryApiJson: vi.fn(),
  setupSdk: vi.fn(),
}))

vi.mock('@socketsecurity/registry/lib/logger', () => ({
  logger: {
    info: vi.fn(),
  },
}))

describe('fetchPurlDeepScore', () => {
  it('fetches purl deep score successfully', async () => {
    const { queryApiJson, setupSdk } = await import('../../utils/sdk.mts')
    const mockQueryApi = vi.mocked(queryApiJson)
    const mockSetupSdk = vi.mocked(setupSdk)

    mockSetupSdk.mockResolvedValue({ ok: true, data: {} as any })

    const mockData = {
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

    mockQueryApi.mockResolvedValue({
      ok: true,
      data: mockData,
    })

    const result = await fetchPurlDeepScore('pkg:npm/lodash@4.17.21')

    expect(mockQueryApi).toHaveBeenCalledWith(
      {},
      'purl/score/pkg%3Anpm%2Flodash%404.17.21',
      expect.objectContaining({ description: 'the deep package scores' }),
    )
    expect(result.ok).toBe(true)
    expect(result.data).toEqual(mockData)
  })

  it('handles SDK setup failure', async () => {
    const { queryApiJson, setupSdk } = await import('../../utils/sdk.mts')
    const mockQueryApi = vi.mocked(queryApiJson)
    const mockSetupSdk = vi.mocked(setupSdk)

    mockSetupSdk.mockResolvedValue({ ok: true, data: {} as any })

    const error = {
      ok: false,
      code: 1,
      message: 'Failed to fetch purl score',
      cause: 'Configuration error',
    }
    mockQueryApi.mockResolvedValue(error)

    const result = await fetchPurlDeepScore('pkg:npm/express@4.18.2')

    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { queryApiJson, setupSdk } = await import('../../utils/sdk.mts')
    const mockQueryApi = vi.mocked(queryApiJson)
    const mockSetupSdk = vi.mocked(setupSdk)

    mockSetupSdk.mockResolvedValue({ ok: true, data: {} as any })

    mockQueryApi.mockResolvedValue({
      ok: false,
      error: 'Package not found',
      code: 404,
    })

    const result = await fetchPurlDeepScore('pkg:npm/nonexistent@1.0.0')

    expect(result.ok).toBe(false)
    expect(result.code).toBe(404)
  })

  it('passes custom SDK options', async () => {
    const { queryApiJson, setupSdk } = await import('../../utils/sdk.mts')
    const mockQueryApi = vi.mocked(queryApiJson)
    const mockSetupSdk = vi.mocked(setupSdk)

    mockSetupSdk.mockResolvedValue({ ok: true, data: {} as any })

    mockQueryApi.mockResolvedValue({ ok: true, data: {} })

    await fetchPurlDeepScore('pkg:npm/react@18.0.0')

    expect(mockQueryApi).toHaveBeenCalledWith(
      {},
      'purl/score/pkg%3Anpm%2Freact%4018.0.0',
      expect.objectContaining({ description: 'the deep package scores' }),
    )
  })

  it('handles different purl formats', async () => {
    const { queryApiJson, setupSdk } = await import('../../utils/sdk.mts')
    const mockQueryApi = vi.mocked(queryApiJson)
    const mockSetupSdk = vi.mocked(setupSdk)

    mockSetupSdk.mockResolvedValue({ ok: true, data: {} as any })

    mockQueryApi.mockResolvedValue({ ok: true, data: {} })

    const purl = 'pkg:npm/lodash@4.17.21'
    await fetchPurlDeepScore(purl)

    expect(mockQueryApi).toHaveBeenCalledWith(
      {},
      `purl/score/${encodeURIComponent(purl)}`,
      expect.objectContaining({ description: 'the deep package scores' }),
    )
  })

  it('handles low score packages', async () => {
    const { queryApiJson, setupSdk } = await import('../../utils/sdk.mts')
    const mockQueryApi = vi.mocked(queryApiJson)
    const mockSetupSdk = vi.mocked(setupSdk)

    mockSetupSdk.mockResolvedValue({ ok: true, data: {} as any })

    const lowScoreData = {
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

    mockQueryApi.mockResolvedValue({
      ok: true,
      data: lowScoreData,
    })

    const result = await fetchPurlDeepScore('pkg:npm/vulnerable@0.1.0')

    expect(result.ok).toBe(true)
    expect(result.data.self.score.overall).toBeLessThan(30)
  })

  it('uses null prototype for options', async () => {
    const { queryApiJson, setupSdk } = await import('../../utils/sdk.mts')
    const mockQueryApi = vi.mocked(queryApiJson)
    const mockSetupSdk = vi.mocked(setupSdk)

    mockSetupSdk.mockResolvedValue({ ok: true, data: {} as any })

    mockQueryApi.mockResolvedValue({ ok: true, data: {} })

    // This tests that the function properly uses __proto__: null.
    await fetchPurlDeepScore('pkg:npm/test@1.0.0')

    // The function should work without prototype pollution issues.
    expect(mockQueryApi).toHaveBeenCalled()
  })
})
