/**
 * Unit tests for content-addressed blob reads.
 *
 * Covers UTF-8 / binary detection, the byte cap, chunked-manifest reassembly,
 * and the manifest validation that keeps a malformed reply from producing a
 * silently short read. `httpRequest` is mocked — no test touches the network.
 *
 * Related Files: - src/commands/mcp/lib/blob.mts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  decodeUtf8Text,
  DEFAULT_BLOB_MAX_BYTES,
  fetchSocketBlob,
  isStringArray,
  SOCKET_USER_CONTENT_URL,
} from '../../../../../src/commands/mcp/lib/blob.mts'

const { mockHttpRequest } = vi.hoisted(() => ({
  mockHttpRequest: vi.fn(),
}))

vi.mock(import('@socketsecurity/lib-stable/http-request/request'), () => ({
  httpRequest: mockHttpRequest,
}))

function okResponse(body: string | Uint8Array, contentType = 'text/plain') {
  const bytes = typeof body === 'string' ? Buffer.from(body, 'utf8') : body
  return {
    arrayBuffer: () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    headers: { 'content-type': contentType },
    ok: true,
    status: 200,
    text: () => Buffer.from(bytes).toString('utf8'),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('fetchSocketBlob — single blob', () => {
  it('returns decoded text for a Q-prefixed hash', async () => {
    mockHttpRequest.mockResolvedValue(okResponse('hello world'))
    const blob = await fetchSocketBlob('Qabc')
    expect(blob.text).toBe('hello world')
    expect(blob.binary).toBe(false)
    expect(blob.bytes).toBe(11)
    expect(blob.truncated).toBe(false)
  })

  it('requests the blob from the Socket user-content host', async () => {
    mockHttpRequest.mockResolvedValue(okResponse('x'))
    await fetchSocketBlob('Qabc')
    expect(mockHttpRequest.mock.calls[0]![0]).toBe(
      `${SOCKET_USER_CONTENT_URL}/blob/Qabc`,
    )
  })

  it('percent-encodes the hash into the path', async () => {
    mockHttpRequest.mockResolvedValue(okResponse('x'))
    await fetchSocketBlob('Qa/b')
    expect(mockHttpRequest.mock.calls[0]![0]).toBe(
      `${SOCKET_USER_CONTENT_URL}/blob/Qa%2Fb`,
    )
  })

  it('sends the CLI user agent rather than a spoofed browser one', async () => {
    mockHttpRequest.mockResolvedValue(okResponse('x'))
    await fetchSocketBlob('Qabc')
    const userAgent = mockHttpRequest.mock.calls[0]![1].headers['user-agent']
    expect(userAgent).not.toContain('Mozilla')
    expect(userAgent.length).toBeGreaterThan(0)
  })

  it('reports the content type', async () => {
    mockHttpRequest.mockResolvedValue(okResponse('x', 'application/json'))
    expect((await fetchSocketBlob('Qabc')).contentType).toBe('application/json')
  })

  it('rejects an empty hash before any request', async () => {
    await expect(fetchSocketBlob('')).rejects.toThrow('empty blob hash')
    expect(mockHttpRequest).not.toHaveBeenCalled()
  })

  it('throws with the status on a non-2xx reply', async () => {
    mockHttpRequest.mockResolvedValue({
      arrayBuffer: () => new ArrayBuffer(0),
      headers: {},
      ok: false,
      status: 404,
      text: () => 'missing',
    })
    await expect(fetchSocketBlob('Qabc')).rejects.toThrow('HTTP 404')
  })

  it('wraps a transport failure with the URL', async () => {
    mockHttpRequest.mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(fetchSocketBlob('Qabc')).rejects.toThrow('ECONNREFUSED')
  })

  it('marks NUL-bearing content as binary and returns no text', async () => {
    mockHttpRequest.mockResolvedValue(
      okResponse(new Uint8Array([0x50, 0x4e, 0x47, 0x00, 0x01])),
    )
    const blob = await fetchSocketBlob('Qabc')
    expect(blob.binary).toBe(true)
    expect(blob.text).toBe('')
  })

  it('marks invalid UTF-8 as binary', async () => {
    mockHttpRequest.mockResolvedValue(okResponse(new Uint8Array([0xff, 0xfe])))
    expect((await fetchSocketBlob('Qabc')).binary).toBe(true)
  })

  it('truncates past the byte cap and flags it', async () => {
    mockHttpRequest.mockResolvedValue(okResponse('abcdefghij'))
    const blob = await fetchSocketBlob('Qabc', { maxBytes: 4 })
    expect(blob.text).toBe('abcd')
    expect(blob.truncated).toBe(true)
    expect(blob.bytes).toBe(10)
  })

  it('defaults the cap to 1 MB', () => {
    expect(DEFAULT_BLOB_MAX_BYTES).toBe(1024 * 1024)
  })
})

describe('fetchSocketBlob — chunked blob', () => {
  function manifestResponse(manifest: unknown) {
    return okResponse(JSON.stringify(manifest), 'application/json')
  }

  it('reassembles chunks listed in the manifest', async () => {
    mockHttpRequest
      .mockResolvedValueOnce(
        manifestResponse({ chunks: ['Qc1', 'Qc2'], size: 6 }),
      )
      .mockResolvedValueOnce(okResponse('abc'))
      .mockResolvedValueOnce(okResponse('def'))
    const blob = await fetchSocketBlob('Sabc')
    expect(blob.text).toBe('abcdef')
    expect(blob.bytes).toBe(6)
  })

  it('reads the manifest from the Q-swapped hash', async () => {
    mockHttpRequest
      .mockResolvedValueOnce(manifestResponse({ chunks: ['Qc1'], size: 1 }))
      .mockResolvedValueOnce(okResponse('a'))
    await fetchSocketBlob('Sxyz')
    expect(mockHttpRequest.mock.calls[0]![0]).toContain('/blob/Qxyz')
  })

  it('stops early using the manifest offsets', async () => {
    mockHttpRequest
      .mockResolvedValueOnce(
        manifestResponse({ chunks: ['Qc1', 'Qc2'], offset: [0, 3], size: 6 }),
      )
      .mockResolvedValueOnce(okResponse('abc'))
    const blob = await fetchSocketBlob('Sabc', { maxBytes: 3 })
    expect(blob.text).toBe('abc')
    expect(blob.truncated).toBe(true)
    // Manifest + first chunk only; the second chunk was never requested.
    expect(mockHttpRequest).toHaveBeenCalledTimes(2)
  })

  it('ignores an offsets array that does not cover every chunk', async () => {
    mockHttpRequest
      .mockResolvedValueOnce(
        manifestResponse({ chunks: ['Qc1', 'Qc2'], offset: [0], size: 6 }),
      )
      .mockResolvedValueOnce(okResponse('abc'))
      .mockResolvedValueOnce(okResponse('def'))
    expect((await fetchSocketBlob('Sabc')).text).toBe('abcdef')
  })

  it('ignores an offsets array with a non-numeric entry', async () => {
    mockHttpRequest
      .mockResolvedValueOnce(
        manifestResponse({ chunks: ['Qc1', 'Qc2'], offset: [0, 'x'], size: 6 }),
      )
      .mockResolvedValueOnce(okResponse('abc'))
      .mockResolvedValueOnce(okResponse('def'))
    expect((await fetchSocketBlob('Sabc')).text).toBe('abcdef')
  })

  it('falls back to the concatenated length when size is missing', async () => {
    mockHttpRequest
      .mockResolvedValueOnce(manifestResponse({ chunks: ['Qc1'] }))
      .mockResolvedValueOnce(okResponse('abcd'))
    expect((await fetchSocketBlob('Sabc')).bytes).toBe(4)
  })

  it('rejects a manifest that is not JSON', async () => {
    mockHttpRequest.mockResolvedValueOnce(okResponse('not json'))
    await expect(fetchSocketBlob('Sabc')).rejects.toThrow('manifest')
  })

  it('rejects a manifest with no chunks array', async () => {
    mockHttpRequest.mockResolvedValueOnce(manifestResponse({ size: 6 }))
    await expect(fetchSocketBlob('Sabc')).rejects.toThrow("'chunks'")
  })

  it('rejects a chunks array holding an empty entry', async () => {
    mockHttpRequest.mockResolvedValueOnce(
      manifestResponse({ chunks: ['Qc1', ''] }),
    )
    await expect(fetchSocketBlob('Sabc')).rejects.toThrow("'chunks'")
  })

  it('rejects a non-object manifest', async () => {
    mockHttpRequest.mockResolvedValueOnce(manifestResponse(42))
    await expect(fetchSocketBlob('Sabc')).rejects.toThrow('non-object')
  })
})

describe('decodeUtf8Text', () => {
  it('decodes valid UTF-8', () => {
    expect(decodeUtf8Text(Buffer.from('héllo', 'utf8'))).toBe('héllo')
  })

  it('returns undefined for a NUL byte', () => {
    expect(decodeUtf8Text(new Uint8Array([0x61, 0x00]))).toBeUndefined()
  })

  it('returns undefined for invalid UTF-8', () => {
    expect(decodeUtf8Text(new Uint8Array([0xc3, 0x28]))).toBeUndefined()
  })

  it('decodes an empty buffer to an empty string', () => {
    expect(decodeUtf8Text(new Uint8Array(0))).toBe('')
  })
})

describe('isStringArray', () => {
  it('accepts an all-string array', () => {
    expect(isStringArray(['a', 'b'])).toBe(true)
  })

  it('accepts an empty array', () => {
    expect(isStringArray([])).toBe(true)
  })

  it.each([[['a', 1]], [null], ['abc'], [{ 0: 'a' }]])(
    'rejects %s',
    value => {
      expect(isStringArray(value)).toBe(false)
    },
  )
})
