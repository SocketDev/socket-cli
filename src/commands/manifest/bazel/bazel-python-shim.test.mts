import { existsSync, readlinkSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@socketsecurity/registry/lib/bin', () => ({
  whichBin: vi.fn(),
}))

import { whichBin } from '@socketsecurity/registry/lib/bin'

import {
  _resetPythonShimCacheForTests,
  provisionPythonShim,
} from './bazel-python-shim.mts'

describe('provisionPythonShim', () => {
  const mocked = vi.mocked(whichBin)
  const SHIM_DIR = path.join(os.tmpdir(), 'socket-cli-bazel-python-shim')

  beforeEach(() => {
    mocked.mockReset()
    _resetPythonShimCacheForTests()
  })

  afterEach(() => {
    // Clean up the shared shim dir between tests to avoid stale symlinks.
    if (existsSync(SHIM_DIR)) {
      rmSync(SHIM_DIR, { recursive: true, force: true })
    }
  })

  it('returns no-shim result when python is already on PATH', async () => {
    mocked.mockResolvedValueOnce('/usr/bin/python')
    const result = await provisionPythonShim()
    expect(result).toEqual({ augmentedEnv: undefined, shimDir: undefined })
  })

  it('creates python symlink shim when only python3 is on PATH', async () => {
    mocked
      .mockResolvedValueOnce(null) // python
      .mockResolvedValueOnce(process.execPath) // python3
    const result = await provisionPythonShim()
    expect(result.shimDir).toBe(SHIM_DIR)
    expect(existsSync(path.join(SHIM_DIR, 'python'))).toBe(true)
    expect(readlinkSync(path.join(SHIM_DIR, 'python'))).toBe(process.execPath)
    const pathValue = result.augmentedEnv?.['PATH'] ?? ''
    expect(pathValue.startsWith(SHIM_DIR)).toBe(true)
  })

  it('throws InputError when neither python nor python3 is found on PATH', async () => {
    mocked.mockResolvedValue(null)
    await expect(provisionPythonShim()).rejects.toThrow(
      /Neither .python. nor .python3/,
    )
  })

  it('is idempotent: returns cached result on second call', async () => {
    mocked
      .mockResolvedValueOnce(null) // python
      .mockResolvedValueOnce(process.execPath) // python3
    const a = await provisionPythonShim()
    const b = await provisionPythonShim()
    // Same object reference — cached.
    expect(b).toBe(a)
    // whichBin only called twice (for the first invocation).
    expect(mocked).toHaveBeenCalledTimes(2)
  })

  it('uses a stable shim dir under os.tmpdir()', async () => {
    mocked
      .mockResolvedValueOnce(null) // python
      .mockResolvedValueOnce(process.execPath) // python3
    const result = await provisionPythonShim()
    expect(result.shimDir).toBe(
      path.join(os.tmpdir(), 'socket-cli-bazel-python-shim'),
    )
  })

  it('symlink target is the absolute resolved python3 path', async () => {
    mocked
      .mockResolvedValueOnce(null) // python
      .mockResolvedValueOnce(process.execPath) // python3
    await provisionPythonShim()
    const linkTarget = readlinkSync(path.join(SHIM_DIR, 'python'))
    // Must be an absolute path.
    expect(path.isAbsolute(linkTarget)).toBe(true)
    expect(linkTarget).toBe(process.execPath)
  })
})
