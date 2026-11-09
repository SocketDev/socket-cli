import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@actions/cache', () => ({
  restoreCache: vi.fn(),
  saveCache: vi.fn(),
}))

import {
  resolveBlobPath,
  runCacheAction,
  seaDownloadBlobPath,
} from '../../../../../../.github/actions/repo/cache-downloads/index.mts'

const reporter = () => ({
  warning: vi.fn(),
  output: vi.fn(async () => undefined),
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('SEA download cache action', () => {
  it('limits the cache path to content-addressed blobs', () => {
    expect(seaDownloadBlobPath('/home/runner')).toBe(
      '/home/runner/.cache/socket-sea/downloads/v1/blobs',
    )
    expect(
      resolveBlobPath('~/.cache/socket-sea/downloads/v1/blobs', '/home/runner'),
    ).toBe('/home/runner/.cache/socket-sea/downloads/v1/blobs')
    expect(() =>
      resolveBlobPath('~/.cache/socket-sea/downloads', '/home/runner'),
    ).toThrow('must target only the blob directory')
  })

  it('reports exact restore-key hits and passes only blob paths', async () => {
    const restoreCache = vi.fn(async () => 'sea-cache-key')
    const saveCache = vi.fn()
    const report = reporter()
    const result = await runCacheAction(
      {
        mode: 'restore',
        key: 'sea-cache-key',
        path: '/runner/cache/blobs',
        restoreKeys: ['sea-cache-prefix-'],
      },
      { restoreCache, saveCache: async () => undefined },
      report,
    )
    expect(result).toEqual({ cacheHit: true })
    expect(restoreCache).toHaveBeenCalledWith(
      ['/runner/cache/blobs'],
      'sea-cache-key',
      ['sea-cache-prefix-'],
    )
    expect(report.output).toHaveBeenCalledWith('cache-hit', 'true')
  })

  it('treats fallback restores as misses so trusted jobs can save the new key', async () => {
    const report = reporter()
    const result = await runCacheAction(
      { mode: 'restore', key: 'new-key', path: '/cache/blobs' },
      { restoreCache: async () => 'old-key', saveCache: async () => undefined },
      report,
    )
    expect(result).toEqual({ cacheHit: false })
    expect(report.output).toHaveBeenCalledWith('cache-hit', 'false')
  })

  it('warns and continues when the cache service cannot restore', async () => {
    const report = reporter()
    const result = await runCacheAction(
      { mode: 'restore', key: 'key', path: '/cache/blobs' },
      {
        restoreCache: async () => {
          throw new Error('cache unavailable')
        },
        saveCache: async () => undefined,
      },
      report,
    )
    expect(result).toEqual({ cacheHit: false })
    expect(report.warning).toHaveBeenCalledWith(
      'SEA download cache restore failed: Error: cache unavailable',
    )
    expect(report.output).toHaveBeenCalledWith('cache-hit', 'false')
  })

  it('warns and continues when saving fails', async () => {
    const report = reporter()
    const saveCache = vi.fn(async () => {
      throw new Error('save denied')
    })
    await expect(
      runCacheAction(
        { mode: 'save', key: 'key', path: '/cache/blobs' },
        { restoreCache: async () => undefined, saveCache },
        report,
      ),
    ).resolves.toEqual({ cacheHit: false })
    expect(saveCache).toHaveBeenCalledWith(['/cache/blobs'], 'key')
    expect(report.warning).toHaveBeenCalledWith(
      'SEA download cache save failed: Error: save denied',
    )
  })

  it('never saves when the Actions cache mode is read-only', async () => {
    vi.stubEnv('ACTIONS_CACHE_MODE', 'read')
    const report = reporter()
    const saveCache = vi.fn(async () => undefined)
    await expect(
      runCacheAction(
        { mode: 'save', key: 'key', path: '/cache/blobs' },
        { restoreCache: async () => undefined, saveCache },
        report,
      ),
    ).resolves.toEqual({ cacheHit: false })
    expect(saveCache).not.toHaveBeenCalled()
    expect(report.warning).toHaveBeenCalledWith(
      'SEA download cache save skipped in read-only mode',
    )
  })

  it.each(['write-only', 'none'])(
    'skips restore when the Actions cache mode is %s',
    async cacheMode => {
      const restoreCache = vi.fn(async () => 'key')
      vi.stubEnv('ACTIONS_CACHE_MODE', cacheMode)
      const report = reporter()
      await expect(
        runCacheAction(
          { mode: 'restore', key: 'key', path: '/cache/blobs' },
          { restoreCache, saveCache: async () => undefined },
          report,
        ),
      ).resolves.toEqual({ cacheHit: false })
      expect(report.output).toHaveBeenCalledWith('cache-hit', 'false')
      expect(restoreCache).not.toHaveBeenCalled()
    },
  )

  it('allows cache restore in read-write mode', async () => {
    vi.stubEnv('ACTIONS_CACHE_MODE', 'write')
    const report = reporter()
    const restoreCache = vi.fn(async () => 'key')
    await expect(
      runCacheAction(
        { mode: 'restore', key: 'key', path: '/cache/blobs' },
        { restoreCache, saveCache: async () => undefined },
        report,
      ),
    ).resolves.toEqual({ cacheHit: true })
    expect(restoreCache).toHaveBeenCalledOnce()
  })

  it('skips saving when the Actions cache is disabled', async () => {
    vi.stubEnv('ACTIONS_CACHE_MODE', 'none')
    const report = reporter()
    const saveCache = vi.fn(async () => undefined)
    await runCacheAction(
      { mode: 'save', key: 'key', path: '/cache/blobs' },
      { restoreCache: async () => undefined, saveCache },
      report,
    )
    expect(saveCache).not.toHaveBeenCalled()
  })

  it('fails for missing inputs or unknown modes', async () => {
    const report = reporter()
    const cache = {
      restoreCache: async () => undefined,
      saveCache: async () => undefined,
    }
    await expect(
      runCacheAction(
        { mode: 'restore', key: '', path: '/cache/blobs' },
        cache,
        report,
      ),
    ).rejects.toThrow('key and path are required')
    await expect(
      runCacheAction(
        { mode: 'other' as 'restore', key: 'key', path: '/cache/blobs' },
        cache,
        report,
      ),
    ).rejects.toThrow('Unknown SEA download cache mode')
  })
})
