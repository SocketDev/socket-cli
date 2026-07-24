/**
 * Unit tests for util/dlx/spawn-pycli.
 *
 * Covers ensureSocketPyCli.
 *
 * Related Files:
 *
 * - Src/util/dlx/spawn-pycli.mts
 * - Spawn-pycli.test.mts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as NodeFs from 'node:fs'

const mockSpawn = vi.hoisted(() => vi.fn())
const mockDownloadBinary = vi.hoisted(() => vi.fn())
const mockGetDlxCachePath = vi.hoisted(() => vi.fn(() => '/tmp/dlx'))
const mockSafeMkdir = vi.hoisted(() => vi.fn(async () => {}))
const mockSafeDelete = vi.hoisted(() => vi.fn(async () => {}))
const mockExistsSync = vi.hoisted(() => vi.fn(() => false))
const mockFsWriteFile = vi.hoisted(() => vi.fn(async () => {}))
const mockFsReadFile = vi.hoisted(() => vi.fn(async () => '99999'))
const mockFsCopyFile = vi.hoisted(() => vi.fn(async () => {}))
const mockSocketHttpRequest = vi.hoisted(() => vi.fn())
const mockGetPyCliVersion = vi.hoisted(() => vi.fn(() => '2.3.4'))
const mockGetPyCliChecksums = vi.hoisted(() => vi.fn(() => ({})))

vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: mockSpawn,
}))

vi.mock(import('@socketsecurity/lib-stable/dlx/binary'), () => ({
  downloadBinary: mockDownloadBinary,
  getDlxCachePath: mockGetDlxCachePath,
}))

vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeMkdir: mockSafeMkdir,
  safeDelete: mockSafeDelete,
}))

vi.mock(import('node:fs'), async () => {
  const actual = await vi.importActual<typeof NodeFs>('node:fs')
  const promises = {
    writeFile: mockFsWriteFile,
    readFile: mockFsReadFile,
    copyFile: mockFsCopyFile,
  }
  return {
    ...actual,
    existsSync: mockExistsSync,
    promises,
    default: { ...actual, existsSync: mockExistsSync, promises },
  }
})

vi.mock(import('../../../../src/util/socket/api.mts'), () => ({
  socketHttpRequest: mockSocketHttpRequest,
}))

vi.mock(import('../../../../src/env/pycli-version.mts'), () => ({
  getPyCliVersion: mockGetPyCliVersion,
}))

vi.mock(import('../../../../src/env/pycli-checksums.mts'), () => ({
  getPyCliChecksums: mockGetPyCliChecksums,
}))

import { ensureSocketPyCli } from '../../../../src/util/dlx/spawn-pycli.mts'

const realSetTimeout = globalThis.setTimeout
function stubFastTimers() {
  ;(globalThis as { setTimeout: unknown }).setTimeout = (cb: () => void) => {
    cb()
    return 0 as never
  }
}
function restoreTimers() {
  ;(globalThis as { setTimeout: unknown }).setTimeout = realSetTimeout
}

describe('ensureSocketPyCli', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExistsSync.mockReturnValue(false)
    mockFsWriteFile.mockResolvedValue(undefined)
    mockFsReadFile.mockResolvedValue('99999')
    mockSafeDelete.mockResolvedValue(undefined)
    mockSpawn.mockResolvedValue({ code: 1 })
    mockGetPyCliVersion.mockReturnValue('2.3.4')
    mockGetPyCliChecksums.mockReturnValue({})
    mockSocketHttpRequest.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => ({
        urls: [{ filename: 'foo-py3-none-any.whl', url: 'http://x' }],
      }),
    })
    mockDownloadBinary.mockResolvedValue({ binaryPath: '/dl/wheel' })
    mockFsCopyFile.mockResolvedValue(undefined)
  })

  it('returns early when already installed', async () => {
    mockSpawn.mockResolvedValue({ code: 0 })
    await ensureSocketPyCli('/py')
    expect(mockFsWriteFile).not.toHaveBeenCalled()
  })

  it('throws after MAX_RETRIES exceeded', async () => {
    await expect(ensureSocketPyCli('/py', 3)).rejects.toThrow(
      /could not acquire the Socket Python CLI install lock/,
    )
  })

  it('installs without checksums (dev mode) using pip install', async () => {
    // First spawn (install check): code 1; second (pip install): code 0.
    let spawnCount = 0
    mockSpawn.mockImplementation(async () => {
      spawnCount += 1
      if (spawnCount === 1) {
        return { code: 1 } as never
      }
      return { code: 0 } as never
    })
    mockGetPyCliVersion.mockReturnValue('^1.2.3')

    await ensureSocketPyCli('/py')
    // The 2nd spawn is the pip install call.
    expect(mockSpawn).toHaveBeenCalledTimes(2)
  })

  it('installs with checksum-verified wheel when checksums present', async () => {
    mockGetPyCliChecksums.mockReturnValue({
      'socketsecurity-2.3.4-py3-none-any.whl': 'sha-xyz',
    })
    let spawnCount = 0
    mockSpawn.mockImplementation(async () => {
      spawnCount += 1
      if (spawnCount === 1) {
        return { code: 1 } as never
      }
      return { code: 0 } as never
    })
    mockExistsSync.mockReturnValue(true)

    await ensureSocketPyCli('/py')
    expect(mockSpawn).toHaveBeenCalledTimes(2)
  })

  it('throws when checksum present but downloadPyPiWheel returns null', async () => {
    mockGetPyCliChecksums.mockReturnValue({
      'socketsecurity-2.3.4-py3-none-any.whl': 'sha-xyz',
    })
    // Make downloadPyPiWheel return null by making wheel response have no urls.
    mockSocketHttpRequest.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => ({ urls: [] }),
    })

    // downloadPyPiWheel will throw before returning null when no wheel
    // matches; either error is acceptable.
    await expect(ensureSocketPyCli('/py')).rejects.toThrow(
      /py3-none-any wheel|could not download the verified/,
    )
  })

  it('rethrows non-EEXIST lock-write errors', async () => {
    mockFsWriteFile.mockRejectedValue(
      Object.assign(new Error('EACCES'), { code: 'EACCES' }),
    )
    await expect(ensureSocketPyCli('/py')).rejects.toThrow(/EACCES/)
  })

  it('waits when lock exists and returns when install completes', async () => {
    stubFastTimers()
    try {
      mockFsWriteFile.mockRejectedValue(
        Object.assign(new Error('EEXIST'), { code: 'EEXIST' }),
      )
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
      // Install check: first call (initial isSocketPyCliInstalled) → false.
      // Inside wait loop, isSocketPyCliInstalled poll → true.
      let spawnCount = 0
      mockSpawn.mockImplementation(async () => {
        spawnCount += 1
        if (spawnCount === 1) {
          return { code: 1 } as never
        }
        return { code: 0 } as never
      })
      try {
        await ensureSocketPyCli('/py')
        expect(spawnCount).toBeGreaterThan(1)
      } finally {
        killSpy.mockRestore()
      }
    } finally {
      restoreTimers()
    }
  })

  it('detects stale lock (dead PID) and retries', async () => {
    let writeCount = 0
    mockFsWriteFile.mockImplementation(async () => {
      writeCount += 1
      if (writeCount === 1) {
        throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
      }
      return undefined
    })
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' })
    })
    // First isSocketPyCliInstalled: not installed; after retry: installed.
    let spawnCount = 0
    mockSpawn.mockImplementation(async () => {
      spawnCount += 1
      if (spawnCount <= 1) {
        return { code: 1 } as never
      }
      return { code: 0 } as never
    })

    try {
      await ensureSocketPyCli('/py')
      expect(spawnCount).toBeGreaterThan(1)
    } finally {
      killSpy.mockRestore()
    }
  })

  it('treats invalid PID as stale and retries', async () => {
    let writeCount = 0
    mockFsWriteFile.mockImplementation(async () => {
      writeCount += 1
      if (writeCount === 1) {
        throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
      }
      return undefined
    })
    mockFsReadFile.mockResolvedValue('not-a-number')
    let spawnCount = 0
    mockSpawn.mockImplementation(async () => {
      spawnCount += 1
      if (spawnCount <= 1) {
        return { code: 1 } as never
      }
      return { code: 0 } as never
    })
    await ensureSocketPyCli('/py')
    expect(spawnCount).toBeGreaterThan(1)
  })

  it('treats unreadable lock as stale and retries', async () => {
    let writeCount = 0
    mockFsWriteFile.mockImplementation(async () => {
      writeCount += 1
      if (writeCount === 1) {
        throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
      }
      return undefined
    })
    mockFsReadFile.mockRejectedValue(new Error('ENOENT'))
    let spawnCount = 0
    mockSpawn.mockImplementation(async () => {
      spawnCount += 1
      if (spawnCount <= 1) {
        return { code: 1 } as never
      }
      return { code: 0 } as never
    })
    await ensureSocketPyCli('/py')
    expect(spawnCount).toBeGreaterThan(1)
  })

  it('hits i % 5 === 4 dead-PID branch in wait loop', async () => {
    stubFastTimers()
    try {
      let writeCount = 0
      mockFsWriteFile.mockImplementation(async () => {
        writeCount += 1
        if (writeCount === 1) {
          throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
        }
        return undefined
      })
      let killCount = 0
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
        killCount += 1
        // First kill (stale check): alive. Second+ (i=4 alive check): dead.
        if (killCount === 1) {
          return true
        }
        throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' })
      })
      // isSocketPyCliInstalled: always false during wait loop.
      // After recursion: true.
      let spawnCount = 0
      mockSpawn.mockImplementation(async () => {
        spawnCount += 1
        // First 6 calls: not installed. After i=4 -> recursive retry: installed.
        if (spawnCount <= 6) {
          return { code: 1 } as never
        }
        return { code: 0 } as never
      })
      try {
        await ensureSocketPyCli('/py')
        expect(killCount).toBeGreaterThan(1)
      } finally {
        killSpy.mockRestore()
      }
    } finally {
      restoreTimers()
    }
  })

  it('hits i % 5 === 4 lock-file-gone branch in wait loop', async () => {
    stubFastTimers()
    try {
      let writeCount = 0
      mockFsWriteFile.mockImplementation(async () => {
        writeCount += 1
        if (writeCount === 1) {
          throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
        }
        return undefined
      })
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
      // First readFile (stale check): valid PID. Second+ (i=4): throw.
      let readCount = 0
      mockFsReadFile.mockImplementation(async () => {
        readCount += 1
        if (readCount === 1) {
          return '12345'
        }
        throw new Error('ENOENT')
      })
      let spawnCount = 0
      mockSpawn.mockImplementation(async () => {
        spawnCount += 1
        if (spawnCount <= 6) {
          return { code: 1 } as never
        }
        return { code: 0 } as never
      })
      try {
        await ensureSocketPyCli('/py')
        expect(readCount).toBeGreaterThan(1)
      } finally {
        killSpy.mockRestore()
      }
    } finally {
      restoreTimers()
    }
  })

  it('treats EPERM at i % 5 === 4 as alive (no retry)', async () => {
    stubFastTimers()
    try {
      let writeCount = 0
      mockFsWriteFile.mockImplementation(async () => {
        writeCount += 1
        // First call EEXIST. After timeout-retry's recursive call: success.
        if (writeCount === 1) {
          throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
        }
        return undefined
      })
      let killCount = 0
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
        killCount += 1
        // First kill (stale check, alive). Subsequent (i=4): EPERM (alive).
        if (killCount === 1) {
          return true
        }
        throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
      })
      // Make isSocketPyCliInstalled stay false during entire wait loop, so we
      // reach i=4 and trigger the lock-aliveness check. Once the loop times
      // out and recurses, the recursive call's first installed-check returns
      // true so we exit.
      let spawnCount = 0
      const SPAWN_BEFORE_INSTALLED = 1 + 30 // initial + 30 poll iterations.
      mockSpawn.mockImplementation(async () => {
        spawnCount += 1
        if (spawnCount <= SPAWN_BEFORE_INSTALLED) {
          return { code: 1 } as never
        }
        return { code: 0 } as never
      })
      try {
        await ensureSocketPyCli('/py')
        expect(killCount).toBeGreaterThan(1)
      } finally {
        killSpy.mockRestore()
      }
    } finally {
      restoreTimers()
    }
  })

  it('retries when wait-loop times out (returns recursive retry)', async () => {
    stubFastTimers()
    try {
      let writeCount = 0
      mockFsWriteFile.mockImplementation(async () => {
        writeCount += 1
        if (writeCount === 1) {
          throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
        }
        return undefined
      })
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
      // Inside wait loop, install check stays false → timeout retry.
      // Recursive call: isSocketPyCliInstalled returns true on first call.
      let spawnCount = 0
      mockSpawn.mockImplementation(async () => {
        spawnCount += 1
        // First 31 calls (initial + 30 polls) return code 1.
        if (spawnCount <= 31) {
          return { code: 1 } as never
        }
        return { code: 0 } as never
      })
      try {
        await ensureSocketPyCli('/py')
        expect(spawnCount).toBeGreaterThan(31)
      } finally {
        killSpy.mockRestore()
      }
    } finally {
      restoreTimers()
    }
  })
})
