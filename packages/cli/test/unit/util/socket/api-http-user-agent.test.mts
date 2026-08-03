/**
 * Unit tests for the User-Agent header on raw Socket API requests.
 *
 * Purpose: `socketHttpRequest` bypasses the SDK, so without an explicit header
 * the Socket API sees only the lib's generic agent and cannot attribute the
 * traffic to a CLI version.
 *
 * Related Files: - util/socket/api-http.mts (implementation) -
 * util/socket/user-agent.mts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockHttpRequest = vi.hoisted(() => vi.fn(async () => ({ ok: true })))

vi.mock(import('@socketsecurity/lib-stable/http-request/request'), () => ({
  httpRequest: mockHttpRequest,
}))

vi.mock(import('../../../../src/util/socket/sdk.mts'), () => ({
  getDefaultApiToken: vi.fn(),
  getExtraCaCerts: () => undefined,
}))

vi.mock(import('../../../../src/util/socket/user-agent.mts'), () => ({
  getCliUserAgent: () => 'socket/9.9.9 node/v22.0.0 linux/x64',
}))

import { socketHttpRequest } from '../../../../src/util/socket/api-http.mts'

describe('socketHttpRequest User-Agent', () => {
  beforeEach(() => {
    mockHttpRequest.mockClear()
  })

  it('sends the CLI user agent on a request with no headers', async () => {
    await socketHttpRequest('https://api.socket.dev/v0/quota')

    expect(mockHttpRequest.mock.calls[0]![1].headers).toEqual({
      'User-Agent': 'socket/9.9.9 node/v22.0.0 linux/x64',
    })
  })

  it('keeps caller headers and adds the user agent alongside them', async () => {
    await socketHttpRequest('https://api.socket.dev/v0/quota', {
      headers: { Authorization: 'Basic xyz' },
    })

    expect(mockHttpRequest.mock.calls[0]![1].headers).toEqual({
      Authorization: 'Basic xyz',
      'User-Agent': 'socket/9.9.9 node/v22.0.0 linux/x64',
    })
  })

  it('lets a caller override the user agent', async () => {
    await socketHttpRequest('https://api.socket.dev/v0/quota', {
      headers: { 'User-Agent': 'custom/1.0' },
    })

    expect(mockHttpRequest.mock.calls[0]![1].headers).toEqual({
      'User-Agent': 'custom/1.0',
    })
  })
})
