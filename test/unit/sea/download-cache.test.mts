import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DownloadIntegrityError,
  cachedDownload,
  hashDownloadBytes,
  validateDownloadDigest,
} from '../../../src/sea/download-cache.mts'

const roots: string[] = []
const bytes = Buffer.from('verified download fixture')
const digest = createHash('sha256').update(bytes).digest('hex')
const fetchAgain = async () => {
  throw new Error('cache hit should not fetch')
}
const neverFetch = async () => {
  throw new Error('must not fetch')
}
const options = (cacheRoot: string, overrides = {}) => ({
  algorithm: 'sha256' as const,
  digest,
  cacheRoot,
  ...overrides,
})

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sea-download-cache-'))
  roots.push(root)
  return root
}

function blobPath(root: string, hash = digest): string {
  return path.join(root, 'v1', 'blobs', 'sha256', hash)
}

function lockPath(root: string): string {
  return path.join(root, 'v1', 'locks', `sha256-${digest}.lock`)
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })),
  )
})

describe('cachedDownload', () => {
  it('reuses a digest-verified hit without fetching', async () => {
    const root = await makeRoot()
    const fetchBytes = async () => bytes
    await expect(
      cachedDownload('https://example.invalid/file', options(root), fetchBytes),
    ).resolves.toEqual(bytes)
    await expect(
      cachedDownload('https://example.invalid/file', options(root), fetchAgain),
    ).resolves.toEqual(bytes)
  })

  it('repairs an invalid regular cache blob under the digest lock', async () => {
    const root = await makeRoot()
    const file = blobPath(root)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, 'corrupt')
    let fetchCount = 0
    const result = await cachedDownload(
      'https://example.invalid/file',
      options(root),
      async () => {
        fetchCount++
        return bytes
      },
    )
    expect(result).toEqual(bytes)
    expect(fetchCount).toBe(1)
    await expect(fs.readFile(file)).resolves.toEqual(bytes)
  })

  it('rejects a downloaded integrity mismatch without publishing it', async () => {
    const root = await makeRoot()
    await expect(
      cachedDownload('https://example.invalid/file', options(root), async () =>
        Buffer.from('wrong bytes'),
      ),
    ).rejects.toBeInstanceOf(DownloadIntegrityError)
    await expect(fs.lstat(blobPath(root))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('coalesces concurrent misses into one fetch', async () => {
    const root = await makeRoot()
    let fetchCount = 0
    const fetchBytes = async () => {
      fetchCount++
      await new Promise(resolve => setTimeout(resolve, 30))
      return bytes
    }
    const results = await Promise.all([
      cachedDownload('https://example.invalid/file', options(root), fetchBytes),
      cachedDownload('https://example.invalid/file', options(root), fetchBytes),
    ])
    expect(results).toEqual([bytes, bytes])
    expect(fetchCount).toBe(1)
  })

  it('falls back after lock timeout without removing the owner lock', async () => {
    const root = await makeRoot()
    const lock = lockPath(root)
    await fs.mkdir(path.dirname(lock), { recursive: true })
    await fs.mkdir(lock)
    let fetchCount = 0
    const result = await cachedDownload(
      'https://example.invalid/file',
      options(root, { lockTimeoutMs: 5, lockPollMs: 1 }),
      async () => {
        fetchCount++
        return bytes
      },
    )
    expect(result).toEqual(bytes)
    expect(fetchCount).toBe(1)
    expect((await fs.lstat(lock)).isDirectory()).toBe(true)
    await expect(fs.lstat(blobPath(root))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('falls back when cache publication fails and cleans its temp and lock', async () => {
    const root = await makeRoot()
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(
      new Error('simulated rename failure'),
    )
    let fetchCount = 0
    await expect(
      cachedDownload(
        'https://example.invalid/file',
        options(root),
        async () => {
          fetchCount++
          return bytes
        },
      ),
    ).resolves.toEqual(bytes)
    expect(fetchCount).toBe(1)
    await expect(fs.lstat(blobPath(root))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect(await fs.readdir(path.join(root, 'v1', 'tmp'))).toEqual([])
    expect(await fs.readdir(path.join(root, 'v1', 'locks'))).toEqual([])
  })

  it('does not traverse a symlink cache root', async () => {
    const root = await makeRoot()
    const outside = path.join(root, 'outside')
    const link = path.join(root, 'cache-link')
    await fs.mkdir(outside)
    await fs.symlink(outside, link, 'dir')
    let fetchCount = 0
    const result = await cachedDownload(
      'https://example.invalid/file',
      options(link),
      async () => {
        fetchCount++
        return bytes
      },
    )
    expect(result).toEqual(bytes)
    expect(fetchCount).toBe(1)
    expect(await fs.readdir(outside)).toEqual([])
  })

  it('does not follow or replace a symlink blob entry', async () => {
    const root = await makeRoot()
    const outside = path.join(root, 'outside.bin')
    const file = blobPath(root)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(outside, 'outside data')
    await fs.symlink(outside, file)
    const result = await cachedDownload(
      'https://example.invalid/file',
      options(root),
      async () => bytes,
    )
    expect(result).toEqual(bytes)
    await expect(fs.readFile(outside, 'utf8')).resolves.toBe('outside data')
    expect((await fs.lstat(file)).isSymbolicLink()).toBe(true)
  })

  it('does not traverse a symlinked restored blob directory', async () => {
    const root = await makeRoot()
    const outside = path.join(root, 'outside')
    await fs.mkdir(path.join(root, 'v1'))
    await fs.mkdir(outside)
    await fs.symlink(outside, path.join(root, 'v1', 'blobs'), 'dir')
    const result = await cachedDownload(
      'https://example.invalid/file',
      options(root),
      async () => bytes,
    )
    expect(result).toEqual(bytes)
    expect(await fs.readdir(outside)).toEqual([])
  })

  it('keeps a replacement lock owned by another process', async () => {
    const root = await makeRoot()
    const lock = lockPath(root)
    let fetchCount = 0
    const result = await cachedDownload(
      'https://example.invalid/file',
      options(root),
      async () => {
        fetchCount++
        await fs.unlink(path.join(lock, '.owner'))
        await fs.rmdir(lock)
        await fs.mkdir(lock)
        await fs.writeFile(path.join(lock, '.owner'), 'another-owner')
        return bytes
      },
    )
    expect(result).toEqual(bytes)
    expect(fetchCount).toBe(1)
    await expect(fs.readFile(path.join(lock, '.owner'), 'utf8')).resolves.toBe(
      'another-owner',
    )
  })

  it('validates digest and size options before calling the fetcher', async () => {
    const root = await makeRoot()
    expect(validateDownloadDigest('sha256', digest.toUpperCase())).toBe(digest)
    expect(hashDownloadBytes(bytes, 'sha256')).toBe(digest)
    await expect(
      cachedDownload(
        'https://example.invalid/file',
        options(root, { digest: '../outside' }),
        neverFetch,
      ),
    ).rejects.toThrow('Invalid sha256 download digest')
    await expect(
      cachedDownload(
        'https://example.invalid/file',
        options(root, { maxBytes: 1 }),
        async () => bytes,
      ),
    ).rejects.toBeInstanceOf(DownloadIntegrityError)
  })

  it('supports sha512 content addressing', async () => {
    const root = await makeRoot()
    const sha512 = createHash('sha512').update(bytes).digest('hex')
    const result = await cachedDownload(
      'https://example.invalid/file',
      { algorithm: 'sha512', digest: sha512, cacheRoot: root },
      async () => bytes,
    )
    expect(result).toEqual(bytes)
    await expect(
      fs.readFile(path.join(root, 'v1', 'blobs', 'sha512', sha512)),
    ).resolves.toEqual(bytes)
  })
})
