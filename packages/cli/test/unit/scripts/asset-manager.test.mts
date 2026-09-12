import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AssetManager } from '../../../scripts/util/asset-manager.mts'

const mocks = vi.hoisted(() => ({
  __proto__: null,
  download: vi.fn(),
  hash: vi.fn(),
  remove: vi.fn(),
  transient: vi.fn(),
}))

vi.mock(import('local-build-infra/lib/github-releases'), () => ({
  downloadReleaseAsset: mocks.download,
}))
vi.mock(import('local-build-infra/lib/github-error-utils'), () => ({
  logTransientErrorHelp: mocks.transient,
}))
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeDelete: mocks.remove,
  safeMkdir: vi.fn(),
}))
vi.mock(import('../../../scripts/util/socket-btm-releases.mts'), () => ({
  computeFileHash: mocks.hash,
}))

const binary = {
  assetFilename: 'node-linux-x64',
  binaryPath: '/tmp/example-binary',
  pinnedSha256: 'example-digest',
  tag: 'node-smol-example-version',
  tool: 'node-smol',
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.download.mockResolvedValue(undefined)
  mocks.hash.mockResolvedValue(binary.pinnedSha256)
})

describe('AssetManager verified downloads', () => {
  it('checks the downloaded mirror bytes against the requested digest', async () => {
    const manager = new AssetManager({ quiet: true })
    await manager.downloadVerifiedBinary(binary)
    expect(mocks.download).toHaveBeenCalledTimes(1)
    expect(mocks.download.mock.calls[0]?.slice(2)).toEqual([
      `base-assets-${binary.tag}`,
      binary.assetFilename,
      binary.binaryPath,
    ])
    expect(mocks.hash).toHaveBeenCalledWith(binary.binaryPath)
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('verifies fallback bytes when the mirror fails', async () => {
    mocks.download.mockRejectedValueOnce(new Error('mirror unavailable'))
    await new AssetManager({ quiet: true }).downloadVerifiedBinary(binary)
    expect(mocks.download).toHaveBeenCalledTimes(2)
    expect(mocks.download.mock.calls[1]?.slice(2)).toEqual([
      binary.tag,
      binary.assetFilename,
      binary.binaryPath,
    ])
    expect(mocks.hash).toHaveBeenCalledWith(binary.binaryPath)
  })

  it('removes mismatched bytes and rejects the download', async () => {
    mocks.hash.mockResolvedValue('different-digest')
    await expect(
      new AssetManager({ quiet: true }).downloadVerifiedBinary(binary),
    ).rejects.toThrow(Error)
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(binary.binaryPath)
  })

  it('reports terminal download failures without hashing missing bytes', async () => {
    const error = new Error('release unavailable')
    mocks.download.mockRejectedValue(error)
    await expect(
      new AssetManager({ quiet: true }).downloadVerifiedBinary(binary),
    ).rejects.toBe(error)
    expect(mocks.transient).toHaveBeenCalledExactlyOnceWith(error)
    expect(mocks.hash).not.toHaveBeenCalled()
  })
})
