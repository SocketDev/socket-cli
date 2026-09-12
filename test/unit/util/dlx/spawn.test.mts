import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  spawnDlx,
  validatePackageName,
} from '../../../../src/util/dlx/spawn.mts'

/**
 * Unit tests for util/dlx/spawn.
 *
 * Related Files: - src/util/dlx/spawn.mts.
 */

const mockSpawn = vi.hoisted(() => vi.fn())
const mockDlxPackage = vi.hoisted(() => vi.fn())

vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: mockSpawn,
}))

vi.mock(import('@socketsecurity/lib-stable/dlx/package'), () => ({
  dlxPackage: mockDlxPackage,
}))

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
    // `a..b` passes the regex, dots are allowed, but trips the traversal check.
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
