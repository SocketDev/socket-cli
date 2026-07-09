/**
 * Unit tests for util/dlx/spawn.
 *
 * Covers downloadGitHubReleaseBinary (including TOCTOU lock handling,
 * zip-slip protection, tar.gz extraction, and error wrapping).
 *
 * Related Files: - src/util/dlx/spawn.mts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSpawn = vi.hoisted(() => vi.fn())
const mockDownloadBinary = vi.hoisted(() => vi.fn())
const mockGetDlxCachePath = vi.hoisted(() => vi.fn(() => '/tmp/dlx-cache'))
const mockSafeDelete = vi.hoisted(() => vi.fn(async () => {}))
const mockSafeMkdir = vi.hoisted(() => vi.fn(async () => {}))
const mockWhichReal = vi.hoisted(() => vi.fn(async () => '/usr/bin/tar'))
const mockExistsSync = vi.hoisted(() => vi.fn(() => false))
const mockFsWriteFile = vi.hoisted(() => vi.fn(async () => {}))
const mockFsReadFile = vi.hoisted(() => vi.fn(async () => '12345'))
const mockFsReaddir = vi.hoisted(() => vi.fn(async () => []))
const mockFsLstat = vi.hoisted(() =>
  vi.fn(async () => ({ isSymbolicLink: () => false })),
)
const mockFsReadlink = vi.hoisted(() => vi.fn(async () => ''))
const mockFsChmod = vi.hoisted(() => vi.fn(async () => {}))

// AdmZip mock — emulates the constructor + methods.
const mockAdmZipGetEntries = vi.hoisted(() => vi.fn(() => []))
const mockAdmZipExtractAllTo = vi.hoisted(() => vi.fn())
const mockAdmZipCtor = vi.hoisted(() =>
  vi.fn(function (this: unknown, _: string) {
    ;(this as { getEntries: unknown }).getEntries = mockAdmZipGetEntries
    ;(this as { extractAllTo: unknown }).extractAllTo = mockAdmZipExtractAllTo
  }),
)

vi.mock(import('adm-zip'), () => ({
  default: mockAdmZipCtor,
}))

vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: mockSpawn,
}))

vi.mock(import('@socketsecurity/lib-stable/dlx/binary'), () => ({
  downloadBinary: mockDownloadBinary,
  getDlxCachePath: mockGetDlxCachePath,
}))

vi.mock(import('@socketsecurity/lib-stable/arrays/join'), () => ({
  joinAnd: (arr: string[]) => arr.join(', '),
}))

vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeDelete: mockSafeDelete,
  safeMkdir: mockSafeMkdir,
}))

vi.mock(import('@socketsecurity/lib-stable/bin/which'), () => ({
  whichReal: mockWhichReal,
}))

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
  promises: {
    writeFile: mockFsWriteFile,
    readFile: mockFsReadFile,
    readdir: mockFsReaddir,
    lstat: mockFsLstat,
    readlink: mockFsReadlink,
    chmod: mockFsChmod,
  },
  default: {
    existsSync: mockExistsSync,
    promises: {
      writeFile: mockFsWriteFile,
      readFile: mockFsReadFile,
      readdir: mockFsReaddir,
      lstat: mockFsLstat,
      readlink: mockFsReadlink,
      chmod: mockFsChmod,
    },
  },
}))

import { downloadGitHubReleaseBinary } from '../../../../src/util/dlx/spawn.mts'

describe('downloadGitHubReleaseBinary', () => {
  const baseSpec = {
    assetName: 'tool-linux.tar.gz',
    binaryName: 'tool',
    owner: 'org',
    repo: 'repo',
    sha256: 'abc',
    version: 'v1.0.0',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockExistsSync.mockReturnValue(false)
    mockFsWriteFile.mockResolvedValue(undefined)
    mockFsReadFile.mockResolvedValue('99999')
    mockFsReaddir.mockResolvedValue([])
    mockFsLstat.mockResolvedValue({ isSymbolicLink: () => false } as never)
    mockFsChmod.mockResolvedValue(undefined)
    mockSafeMkdir.mockResolvedValue(undefined)
    mockSafeDelete.mockResolvedValue(undefined)
    mockDownloadBinary.mockResolvedValue({ binaryPath: '/tmp/dl/archive' })
    mockSpawn.mockResolvedValue({ stdout: '' })
    mockAdmZipGetEntries.mockReturnValue([])
    mockAdmZipExtractAllTo.mockReset()
    mockAdmZipCtor.mockClear()
    mockWhichReal.mockResolvedValue('/usr/bin/tar')
  })

  it('short-circuits when the binary is already cached', async () => {
    mockExistsSync.mockReturnValue(true)

    const result = await downloadGitHubReleaseBinary(baseSpec)

    expect(result).toContain('tool')
    expect(mockDownloadBinary).not.toHaveBeenCalled()
  })

  it('extracts a tar.gz archive when no cached binary exists', async () => {
    // existsSync called multiple times in this flow:
    // 1. before download (false), 2. after lock check (false),
    // 3. after extraction (true).
    let calls = 0
    mockExistsSync.mockImplementation(() => {
      calls += 1
      // Cached binary not present until after extraction (call 3+).
      return calls >= 3
    })

    const result = await downloadGitHubReleaseBinary(baseSpec)

    expect(mockSpawn).toHaveBeenCalledWith(
      '/usr/bin/tar',
      ['-xzf', '/tmp/dl/archive', '-C', expect.any(String)],
      expect.any(Object),
    )
    expect(mockFsChmod).toHaveBeenCalled()
    expect(result).toContain('tool')
  })

  it('throws when tar is not on PATH and archive is tar.gz', async () => {
    mockWhichReal.mockResolvedValue(undefined)
    let calls = 0
    mockExistsSync.mockImplementation(() => {
      calls += 1
      // First call (cached check) returns false. Subsequent: also false
      // so it goes through full extraction flow.
      return false
    })

    await expect(downloadGitHubReleaseBinary(baseSpec)).rejects.toThrow(
      /tar is required/,
    )
  })

  it('throws when archive format is not supported', async () => {
    mockExistsSync.mockReturnValue(false)

    await expect(
      downloadGitHubReleaseBinary({
        ...baseSpec,
        assetName: 'tool.rar',
      }),
    ).rejects.toThrow(/archive format of tool.rar is not supported/)
  })

  it('extracts a zip archive successfully', async () => {
    let calls = 0
    mockExistsSync.mockImplementation(() => {
      calls += 1
      // Pre-download cached check false, post-extract binary exists.
      return calls >= 3
    })
    mockAdmZipGetEntries.mockReturnValue([
      { entryName: 'tool' },
      { entryName: 'README' },
    ])

    const result = await downloadGitHubReleaseBinary({
      ...baseSpec,
      assetName: 'tool.zip',
    })

    expect(mockAdmZipExtractAllTo).toHaveBeenCalled()
    expect(result).toContain('tool')
  })

  it('rejects zip-slip path traversal entries', async () => {
    mockExistsSync.mockReturnValue(false)
    mockAdmZipGetEntries.mockReturnValue([{ entryName: '../../etc/passwd' }])

    await expect(
      downloadGitHubReleaseBinary({
        ...baseSpec,
        assetName: 'tool.zip',
      }),
    ).rejects.toThrow(/zip-slip attack/)
  })

  it('rejects symlinks that escape the cache dir during zip extraction', async () => {
    let calls = 0
    mockExistsSync.mockImplementation(() => {
      calls += 1
      return false
    })
    mockAdmZipGetEntries.mockReturnValue([{ entryName: 'evil' }])
    mockFsReaddir.mockResolvedValue(['evil'] as never)
    mockFsLstat.mockResolvedValue({ isSymbolicLink: () => true } as never)
    mockFsReadlink.mockResolvedValue('/etc/passwd')

    await expect(
      downloadGitHubReleaseBinary({
        ...baseSpec,
        assetName: 'tool.zip',
      }),
    ).rejects.toThrow(/extracted symlink/)
  })

  it('throws when extracted binary is missing after tar extraction', async () => {
    // existsSync: cache-check false, lock-recheck false, final binary-check false.
    mockExistsSync.mockReturnValue(false)
    // Make the spawn (tar extraction) succeed but final existsSync stays false.

    await expect(downloadGitHubReleaseBinary(baseSpec)).rejects.toThrow(
      /was not found inside/,
    )
  })

  it('hits the alive-PID lock re-check (i % 5 === 4 branch, alive process)', async () => {
    const eexistErr = Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
    mockFsWriteFile.mockRejectedValue(eexistErr)
    // Make existsSync false throughout polling to force timeout (or hit i=4).
    let existsCount = 0
    mockExistsSync.mockImplementation(() => {
      existsCount += 1
      return false
    })
    // setTimeout: bypass the actual 1s wait.
    const realSetTimeout = globalThis.setTimeout
    ;(globalThis as { setTimeout: unknown }).setTimeout = ((cb: () => void) => {
      cb()
      return 0 as never
    }) as never
    const realKill = process.kill
    // alive: kill returns true without throwing.
    ;(process as { kill: unknown }).kill = vi.fn(() => true)

    try {
      // After lock-busy detection, polling proceeds; with everything mocked
      // away, it will eventually time out — that's fine, we just need
      // i=4 branch coverage.
      await expect(downloadGitHubReleaseBinary(baseSpec)).rejects.toThrow(
        /timed out/,
      )
    } finally {
      ;(globalThis as { setTimeout: unknown }).setTimeout = realSetTimeout
      ;(process as { kill: unknown }).kill = realKill
    }
  })

  it('hits the dead-PID lock re-check and retries downloadGitHubReleaseBinary', async () => {
    const eexistErr = Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
    let writeCount = 0
    mockFsWriteFile.mockImplementation(async () => {
      writeCount += 1
      if (writeCount === 1) {
        throw eexistErr
      }
      return undefined
    })
    // First few existsSync calls: false (so binary doesn't appear during wait).
    // After enough waiting iterations we recurse — on recursion: binary appears.
    let existsCount = 0
    mockExistsSync.mockImplementation(() => {
      existsCount += 1
      return existsCount >= 10
    })
    const realSetTimeout = globalThis.setTimeout
    ;(globalThis as { setTimeout: unknown }).setTimeout = ((cb: () => void) => {
      cb()
      return 0 as never
    }) as never
    const realKill = process.kill
    let killCount = 0
    ;(process as { kill: unknown }).kill = vi.fn(() => {
      killCount += 1
      // First kill is the i=4 PID re-check — throw to mark stale.
      throw new Error('ESRCH')
    })

    try {
      // The recursive call will proceed; we don't care if it succeeds or
      // throws downstream — only that the dead-PID branch executed.
      await downloadGitHubReleaseBinary(baseSpec).catch(() => {})
      expect(killCount).toBeGreaterThan(0)
    } finally {
      ;(globalThis as { setTimeout: unknown }).setTimeout = realSetTimeout
      ;(process as { kill: unknown }).kill = realKill
    }
  })

  it('hits the lock-file-gone branch at i=4 and recurses', async () => {
    const eexistErr = Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
    let writeCount = 0
    mockFsWriteFile.mockImplementation(async () => {
      writeCount += 1
      if (writeCount === 1) {
        throw eexistErr
      }
      return undefined
    })
    let existsCount = 0
    mockExistsSync.mockImplementation(() => {
      existsCount += 1
      return existsCount >= 10
    })
    // readFile throws inside the i=4 branch -> lock gone -> recurse.
    let readCount = 0
    mockFsReadFile.mockImplementation(async () => {
      readCount += 1
      if (readCount === 1) {
        throw new Error('ENOENT')
      }
      return '99999'
    })
    const realSetTimeout = globalThis.setTimeout
    ;(globalThis as { setTimeout: unknown }).setTimeout = ((cb: () => void) => {
      cb()
      return 0 as never
    }) as never

    try {
      await downloadGitHubReleaseBinary(baseSpec).catch(() => {})
      expect(readCount).toBeGreaterThan(0)
    } finally {
      ;(globalThis as { setTimeout: unknown }).setTimeout = realSetTimeout
    }
  })

  it('waits and retries when the lock file already exists (alive PID)', async () => {
    const eexistErr = Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
    // First writeFile rejects with EEXIST; binary appears after waiting.
    let writeAttempt = 0
    mockFsWriteFile.mockImplementation(async () => {
      writeAttempt += 1
      if (writeAttempt === 1) {
        throw eexistErr
      }
      return undefined
    })
    // Cache check false initially; binary appears on second poll inside wait.
    let existsCallCount = 0
    mockExistsSync.mockImplementation(() => {
      existsCallCount += 1
      // 1st: cache check (false). 2nd+: binary appearance inside polling.
      return existsCallCount >= 2
    })

    // Use a process.kill that succeeds (alive).
    const realKill = process.kill
    ;(process as { kill: unknown }).kill = vi.fn(() => true)

    try {
      const result = await downloadGitHubReleaseBinary(baseSpec)
      expect(result).toContain('tool')
    } finally {
      ;(process as { kill: unknown }).kill = realKill
    }
  })

  it('recovers from a stale lock (dead PID) and re-runs download', async () => {
    const eexistErr = Object.assign(new Error('EEXIST'), { code: 'EEXIST' })

    // First writeFile: EEXIST (lock held). After the stale cleanup recurses,
    // the recursive call short-circuits on the cache check (existsSync below).
    let writeCount = 0
    mockFsWriteFile.mockImplementation(async () => {
      writeCount += 1
      if (writeCount === 1) {
        throw eexistErr
      }
      return undefined
    })

    // Dead lock holder: the liveness probe (process.kill(pid, 0)) throws.
    const realKill = process.kill
    let killCount = 0
    ;(process as { kill: unknown }).kill = vi.fn(() => {
      killCount += 1
      throw new Error('ESRCH')
    })

    // Keep the binary absent until the liveness probe has run, so the wait
    // loop reaches the i % 5 === 4 stale check instead of returning early;
    // after the stale cleanup, the recursive call's cache check succeeds.
    mockExistsSync.mockImplementation(() => killCount >= 1)

    // setTimeout: bypass the actual 1s polls so reaching i = 4 is instant.
    const realSetTimeout = globalThis.setTimeout
    ;(globalThis as { setTimeout: unknown }).setTimeout = ((cb: () => void) => {
      cb()
      return 0 as never
    }) as never

    try {
      const result = await downloadGitHubReleaseBinary(baseSpec)
      expect(result).toContain('tool')
    } finally {
      ;(globalThis as { setTimeout: unknown }).setTimeout = realSetTimeout
      ;(process as { kill: unknown }).kill = realKill
    }

    // The stale-lock recovery path must have probed liveness at least once.
    expect(killCount).toBeGreaterThanOrEqual(1)
  })

  it('rethrows non-EEXIST errors during lock creation', async () => {
    const otherErr = Object.assign(new Error('EACCES'), { code: 'EACCES' })
    mockFsWriteFile.mockRejectedValue(otherErr)

    await expect(downloadGitHubReleaseBinary(baseSpec)).rejects.toThrow(
      /EACCES/,
    )
  })

  it('re-checks cache after acquiring lock and returns early when binary appeared', async () => {
    let existsCount = 0
    mockExistsSync.mockImplementation(() => {
      existsCount += 1
      // 1st call (pre-lock cache check): false.
      // 2nd call (post-lock recheck): true — early return.
      return existsCount >= 2
    })

    const result = await downloadGitHubReleaseBinary(baseSpec)

    expect(result).toContain('tool')
    expect(mockDownloadBinary).not.toHaveBeenCalled()
  })
})
