import { ReadableStream } from 'node:stream/web'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { downloadBytes } from '../../../src/sea/download-bytes.mts'

const sourceUrl = 'https://downloads.example.invalid/pinned.tar.gz'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SEA bounded downloads', () => {
  it('retries a truncated body with a fresh response and returns only complete bytes', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock
      .mockResolvedValueOnce(truncatedResponse())
      .mockResolvedValueOnce(new Response('complete payload'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await downloadBytes(sourceUrl, { timeoutMs: 30_000 })

    expect(result.toString()).toBe('complete payload')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstSignal = fetchMock.mock.calls[0]![1]?.signal
    const secondSignal = fetchMock.mock.calls[1]![1]?.signal
    expect(firstSignal).toBeInstanceOf(AbortSignal)
    expect(secondSignal).toBeInstanceOf(AbortSignal)
    expect(secondSignal).not.toBe(firstSignal)
  }, 10_000)

  it('stops after three attempts and reports the URL and final cause', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(truncatedResponse('attempt one'))
      .mockResolvedValueOnce(truncatedResponse('attempt two'))
      .mockResolvedValueOnce(truncatedResponse('attempt three'))
    vi.stubGlobal('fetch', fetchMock)

    const error = await downloadBytes(sourceUrl).catch(cause => cause as Error)

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(error.message).toContain(sourceUrl)
    expect(error.message).toContain('after 3 attempts')
    expect(error.cause).toMatchObject({ message: 'terminated: attempt three' })
    expect(
      (error.cause as Error & { cause?: { code?: string } }).cause?.code,
    ).toBe('UND_ERR_RES_CONTENT_LENGTH_MISMATCH')
  }, 10_000)

  it('retries transient HTTP status responses', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('temporarily unavailable', { status: 503 }),
      )
      .mockResolvedValueOnce(new Response('recovered'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(downloadBytes(sourceUrl)).resolves.toEqual(
      Buffer.from('recovered'),
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  }, 10_000)

  it('does not retry permanent HTTP failures or nontransport errors', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockRejectedValueOnce(
        Object.assign(new Error('certificate expired'), {
          cause: { code: 'CERT_HAS_EXPIRED' },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(downloadBytes(sourceUrl)).rejects.toThrow(/HTTP 404/)
    await expect(downloadBytes(sourceUrl)).rejects.toThrow(
      /certificate expired/,
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry declared or streamed byte-limit failures', async () => {
    const declaredResponse = new Response('12345', {
      headers: { 'content-length': '5' },
    })
    const streamedResponse = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Buffer.from('123'))
          controller.enqueue(Buffer.from('45'))
          controller.close()
        },
      }),
    )
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(declaredResponse)
      .mockResolvedValueOnce(streamedResponse)
    vi.stubGlobal('fetch', fetchMock)

    await expect(downloadBytes(sourceUrl, { maxBytes: 4 })).rejects.toThrow(
      /4-byte limit/,
    )
    await expect(downloadBytes(sourceUrl, { maxBytes: 4 })).rejects.toThrow(
      /4-byte limit/,
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(declaredResponse.bodyUsed).toBe(true)
    expect(streamedResponse.bodyUsed).toBe(true)
  })
})

function truncatedResponse(attempt: string): Response {
  let firstChunk = true
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (firstChunk) {
          firstChunk = false
          controller.enqueue(Buffer.from('partial payload'))
          return
        }
        controller.error(
          new TypeError(`terminated: ${attempt}`, {
            cause: { code: 'UND_ERR_RES_CONTENT_LENGTH_MISMATCH' },
          }),
        )
      },
    },
    { highWaterMark: 0 },
  )
  return new Response(body, { headers: { 'content-length': '100' } })
}
