import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  blobCacheWeight,
  evictBlobCache,
  getOrFetchSocketBlob,
  resetBlobCache,
} from '../../../../../src/commands/mcp/lib/blob-cache.mts'

import type { BlobResult } from '../../../../../src/commands/mcp/lib/blob.mts'

const { mockFetchSocketBlob } = vi.hoisted(() => ({
  mockFetchSocketBlob: vi.fn(),
}))

vi.mock(import('../../../../../src/commands/mcp/lib/blob.mts'), () => ({
  fetchSocketBlob: mockFetchSocketBlob,
}))

function textBlob(text: string): BlobResult {
  return {
    binary: false,
    bytes: Buffer.byteLength(text),
    contentType: 'text/plain',
    text,
    truncated: false,
  }
}

beforeEach(() => {
  resetBlobCache()
  mockFetchSocketBlob.mockReset()
})

afterEach(() => {
  resetBlobCache()
})

describe('blob cache', () => {
  it('accounts for UTF-8 bytes and binary entry overhead', () => {
    expect(blobCacheWeight(textBlob('é🙂'))).toBe(518)
    expect(blobCacheWeight({ ...textBlob(''), binary: true })).toBe(512)
  })

  it('reuses fetched blobs by hash and keeps different hashes separate', async () => {
    const first = textBlob('first file')
    const second = textBlob('second file')
    mockFetchSocketBlob
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)

    expect(await getOrFetchSocketBlob('Qfirst-file')).toBe(first)
    expect(await getOrFetchSocketBlob('Qsecond-file')).toBe(second)
    expect(await getOrFetchSocketBlob('Qfirst-file')).toBe(first)
    expect(mockFetchSocketBlob.mock.calls).toEqual([
      ['Qfirst-file'],
      ['Qsecond-file'],
    ])
  })

  it('shares concurrent misses for one hash', async () => {
    const pending = Promise.withResolvers<BlobResult>()
    const blob = textBlob('shared file')
    mockFetchSocketBlob.mockReturnValueOnce(pending.promise)

    const first = getOrFetchSocketBlob('Qshared-file')
    const second = getOrFetchSocketBlob('Qshared-file')
    expect(mockFetchSocketBlob).toHaveBeenCalledTimes(1)
    pending.resolve(blob)

    expect(await first).toBe(blob)
    expect(await second).toBe(blob)
    expect(await getOrFetchSocketBlob('Qshared-file')).toBe(blob)
    expect(mockFetchSocketBlob).toHaveBeenCalledTimes(1)
  })

  it('retries after a shared fetch fails', async () => {
    const pending = Promise.withResolvers<BlobResult>()
    const failure = new Error('Blob fetch failed')
    const blob = textBlob('retried file')
    mockFetchSocketBlob
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(blob)

    const results = Promise.allSettled([
      getOrFetchSocketBlob('Qretry-file'),
      getOrFetchSocketBlob('Qretry-file'),
    ])
    pending.reject(failure)
    expect(await results).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure },
    ])
    expect(await getOrFetchSocketBlob('Qretry-file')).toBe(blob)
    expect(mockFetchSocketBlob).toHaveBeenCalledTimes(2)
  })

  it('evicts the least recently read blob when another entry exceeds capacity', async () => {
    const halfCapacity = textBlob('x'.repeat(8 * 1024 * 1024 - 512))
    mockFetchSocketBlob.mockResolvedValue(halfCapacity)

    await getOrFetchSocketBlob('Qrecent-file')
    await getOrFetchSocketBlob('Qoldest-file')
    await getOrFetchSocketBlob('Qrecent-file')
    await getOrFetchSocketBlob('Qnewest-file')
    await getOrFetchSocketBlob('Qrecent-file')
    expect(mockFetchSocketBlob).toHaveBeenCalledTimes(3)

    await getOrFetchSocketBlob('Qoldest-file')
    expect(mockFetchSocketBlob).toHaveBeenCalledTimes(4)
    expect(mockFetchSocketBlob).toHaveBeenLastCalledWith('Qoldest-file')
  })

  it('caches an entry at capacity and returns larger entries without retaining them', async () => {
    const atCapacity = textBlob('x'.repeat(16 * 1024 * 1024 - 512))
    const oversized = textBlob(`${atCapacity.text}x`)
    mockFetchSocketBlob
      .mockResolvedValueOnce(atCapacity)
      .mockResolvedValue(oversized)

    expect(await getOrFetchSocketBlob('Qcapacity-file')).toBe(atCapacity)
    expect(await getOrFetchSocketBlob('Qoversized-file')).toBe(oversized)
    expect(await getOrFetchSocketBlob('Qoversized-file')).toBe(oversized)
    expect(await getOrFetchSocketBlob('Qcapacity-file')).toBe(atCapacity)
    expect(mockFetchSocketBlob).toHaveBeenCalledTimes(3)
  })

  it('clears cached entries and resets capacity accounting', async () => {
    const atCapacity = textBlob('x'.repeat(16 * 1024 * 1024 - 512))
    const replacement = textBlob('replacement file')
    mockFetchSocketBlob
      .mockResolvedValueOnce(atCapacity)
      .mockResolvedValue(replacement)
    await getOrFetchSocketBlob('Qreset-file')

    resetBlobCache()
    evictBlobCache()
    expect(await getOrFetchSocketBlob('Qreset-file')).toBe(replacement)
    expect(await getOrFetchSocketBlob('Qreset-file')).toBe(replacement)
    expect(mockFetchSocketBlob).toHaveBeenCalledTimes(2)
  })
})
