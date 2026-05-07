/**
 * Unit tests for fetchPurlDeepScore.
 *
 * Thin wrapper around queryApiSafeJson — verifies URL encoding, info
 * logging, and that the query result is returned unchanged.
 *
 * Related Files:
 * - src/commands/package/fetch-purl-deep-score.mts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockQueryApiSafeJson = vi.hoisted(() => vi.fn())
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
}))

vi.mock('../../../../src/utils/socket/api.mts', () => ({
  queryApiSafeJson: mockQueryApiSafeJson,
}))
vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))

import { fetchPurlDeepScore } from '../../../../src/commands/package/fetch-purl-deep-score.mts'

describe('fetchPurlDeepScore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('encodes the PURL into the request path', async () => {
    mockQueryApiSafeJson.mockResolvedValueOnce({ ok: true, data: {} })
    const purl = 'pkg:npm/lodash@4.17.21'

    await fetchPurlDeepScore(purl)

    expect(mockQueryApiSafeJson).toHaveBeenCalledWith(
      `purl/score/${encodeURIComponent(purl)}`,
      'the deep package scores',
    )
  })

  it('logs an info message before issuing the request', async () => {
    mockQueryApiSafeJson.mockResolvedValueOnce({ ok: true, data: {} })

    await fetchPurlDeepScore('pkg:npm/foo@1.0.0')

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('pkg:npm/foo@1.0.0'),
    )
  })

  it('returns the response from queryApiSafeJson unchanged on success', async () => {
    const response = {
      ok: true as const,
      data: {
        purl: 'pkg:npm/foo@1.0.0',
        self: { purl: 'pkg:npm/foo@1.0.0' },
        transitively: { dependencyCount: 5 },
      },
    }
    mockQueryApiSafeJson.mockResolvedValueOnce(response)

    const result = await fetchPurlDeepScore('pkg:npm/foo@1.0.0')

    expect(result).toBe(response)
  })

  it('returns the response from queryApiSafeJson unchanged on failure', async () => {
    const response = { ok: false as const, message: '500 from API' }
    mockQueryApiSafeJson.mockResolvedValueOnce(response)

    const result = await fetchPurlDeepScore('pkg:npm/foo@1.0.0')

    expect(result).toBe(response)
  })
})
