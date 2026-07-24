/**
 * Unit tests for util/dlx/spawn.
 *
 * Covers validatePackageName, spawnDlx, and spawnToolVfs.
 *
 * Related Files: - src/util/dlx/spawn.mts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSpawn = vi.hoisted(() => vi.fn())
const mockDlxPackage = vi.hoisted(() => vi.fn())
const mockAreExternalToolsAvailable = vi.hoisted(() => vi.fn(() => false))
const mockExtractExternalTools = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: mockSpawn,
}))

vi.mock(import('@socketsecurity/lib-stable/dlx/package'), () => ({
  dlxPackage: mockDlxPackage,
}))

vi.mock(import('../../../../src/util/dlx/vfs-extract.mts'), () => ({
  areExternalToolsAvailable: mockAreExternalToolsAvailable,
  extractExternalTools: mockExtractExternalTools,
}))

import {
  spawnDlx,
  spawnToolVfs,
  validatePackageName,
} from '../../../../src/util/dlx/spawn.mts'

describe('validatePackageName', () => {
  it('accepts plain package names', () => {
    expect(() => validatePackageName('lodash')).not.toThrow()
  })

  it('accepts scoped names', () => {
    expect(() => validatePackageName('@socketsecurity/cli')).not.toThrow()
  })

  it('accepts names with allowed punctuation', () => {
    expect(() => validatePackageName('my-pkg_v2.0')).not.toThrow()
  })

  it('rejects uppercase letters', () => {
    expect(() => validatePackageName('MyPkg')).toThrow(/must match/)
  })

  it('rejects names that start with invalid chars', () => {
    expect(() => validatePackageName('.hidden')).toThrow(/must match/)
  })

  it('rejects names that fail the npm regex like slashes outside scope', () => {
    expect(() => validatePackageName('foo/bar')).toThrow(/must match/)
  })

  it('rejects names containing ".." path traversal (passes regex, fails traversal check)', () => {
    // `a..b` passes the regex (dots are allowed) but trips the traversal check.
    expect(() => validatePackageName('a..b')).toThrow(/path traversal/)
  })

  it('rejects empty name', () => {
    expect(() => validatePackageName('')).toThrow(/must match/)
  })
})

describe('spawnDlx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forwards to dlxPackage with default force=false', async () => {
    mockDlxPackage.mockResolvedValue({ spawnPromise: 'p' })

    const result = await spawnDlx({ name: 'lodash', version: '4.17.21' }, [
      '--help',
    ])

    expect(mockDlxPackage).toHaveBeenCalledWith(
      ['--help'],
      expect.objectContaining({
        force: false,
        spec: 'lodash@4.17.21',
      }),
      undefined,
    )
    expect(result).toEqual({ spawnPromise: 'p' })
  })

  it('passes force=true and binaryName', async () => {
    mockDlxPackage.mockResolvedValue({ spawnPromise: 'p' })

    await spawnDlx(
      { name: 'lodash', version: '1.0.0', binaryName: 'lodash-bin' },
      [],
      {
        force: true,
      },
    )

    expect(mockDlxPackage).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        binaryName: 'lodash-bin',
        force: true,
      }),
      undefined,
    )
  })

  it('throws when package name fails validation', async () => {
    await expect(
      spawnDlx({ name: 'BAD/NAME', version: '1.0.0' }, []),
    ).rejects.toThrow(/must match/)
  })
})

describe('spawnToolVfs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAreExternalToolsAvailable.mockReturnValue(true)
  })

  it('throws when external tools are not available', async () => {
    mockAreExternalToolsAvailable.mockReturnValue(false)

    await expect(spawnToolVfs('sfw', [])).rejects.toThrow(
      /cannot spawn sfw from VFS/,
    )
  })

  it('throws when extractExternalTools returns null', async () => {
    mockExtractExternalTools.mockResolvedValue(undefined)

    await expect(spawnToolVfs('sfw', [])).rejects.toThrow(
      /failed to extract sfw from VFS/,
    )
  })

  it('throws when the tool is missing from the extraction map', async () => {
    mockExtractExternalTools.mockResolvedValue({
      other: '/path/to/other',
    } as never)

    await expect(spawnToolVfs('sfw', [])).rejects.toThrow(
      /sfw was not in the output map/,
    )
  })

  it('spawns the tool directly and returns spawnPromise', async () => {
    mockExtractExternalTools.mockResolvedValue({
      sfw: '/path/to/sfw',
    } as never)
    mockSpawn.mockReturnValue('p')

    const result = await spawnToolVfs('sfw', ['arg1'], { env: { X: '1' } })

    expect(mockSpawn).toHaveBeenCalledWith(
      '/path/to/sfw',
      ['arg1'],
      expect.objectContaining({ stdio: 'inherit' }),
    )
    const opts = mockSpawn.mock.calls[0][2]
    expect(opts.env.X).toBe('1')
    expect(result).toEqual({ spawnPromise: 'p' })
  })

  it('honors custom stdio from spawnExtra', async () => {
    mockExtractExternalTools.mockResolvedValue({
      sfw: '/path/to/sfw',
    } as never)
    mockSpawn.mockReturnValue('p')

    await spawnToolVfs('sfw', [], undefined, { stdio: 'pipe' })

    expect(mockSpawn).toHaveBeenCalledWith(
      '/path/to/sfw',
      [],
      expect.objectContaining({ stdio: 'pipe' }),
    )
  })
})
