/**
 * Unit tests for util/dlx/spawn-pycli.
 *
 * Covers ensurePython and ensurePythonDlx.
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
const mockWhichReal = vi.hoisted(() => vi.fn(async () => '/usr/bin/tar'))
const mockSafeMkdir = vi.hoisted(() => vi.fn(async () => {}))
const mockSafeDelete = vi.hoisted(() => vi.fn(async () => {}))
const mockExistsSync = vi.hoisted(() => vi.fn(() => false))
const mockFsWriteFile = vi.hoisted(() => vi.fn(async () => {}))
const mockFsReadFile = vi.hoisted(() => vi.fn(async () => '99999'))
const mockFsChmod = vi.hoisted(() => vi.fn(async () => {}))
const mockAreBasicsToolsAvailable = vi.hoisted(() => vi.fn(() => false))
const mockExtractBasicsTools = vi.hoisted(() => vi.fn(async () => undefined))
const mockGetBasicsToolPaths = vi.hoisted(() =>
  vi.fn(() => ({ python: '/basics/python' })),
)
const mockIsSeaBinary = vi.hoisted(() => vi.fn(() => false))
const mockSocketHttpRequest = vi.hoisted(() => vi.fn())
const mockGetPythonVersion = vi.hoisted(() => vi.fn(() => '3.12.0'))
const mockGetPythonBuildTag = vi.hoisted(() => vi.fn(() => '20240101'))
const mockRequirePythonChecksum = vi.hoisted(() => vi.fn(() => 'sha256-abc'))

let mockSocketCliPythonPath: string | undefined = undefined
vi.mock(import('../../../../src/env/socket-cli-python-path.mts'), () => ({
  get SOCKET_CLI_PYTHON_PATH() {
    return mockSocketCliPythonPath
  },
}))

vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: mockSpawn,
}))

vi.mock(import('@socketsecurity/lib-stable/dlx/binary'), () => ({
  downloadBinary: mockDownloadBinary,
  getDlxCachePath: mockGetDlxCachePath,
}))

vi.mock(import('@socketsecurity/lib-stable/bin/which'), () => ({
  whichReal: mockWhichReal,
}))

vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeMkdir: mockSafeMkdir,
  safeDelete: mockSafeDelete,
}))

vi.mock(import('@socketsecurity/lib-stable/constants/platform'), () => ({
  WIN32: false,
}))

vi.mock(import('node:fs'), async () => {
  const actual = await vi.importActual<typeof NodeFs>('node:fs')
  const promises = {
    writeFile: mockFsWriteFile,
    readFile: mockFsReadFile,
    chmod: mockFsChmod,
  }
  return {
    ...actual,
    existsSync: mockExistsSync,
    promises,
    default: { ...actual, existsSync: mockExistsSync, promises },
  }
})

vi.mock(import('../../../../src/util/basics/vfs-extract.mts'), () => ({
  areBasicsToolsAvailable: mockAreBasicsToolsAvailable,
  extractBasicsTools: mockExtractBasicsTools,
  getBasicsToolPaths: mockGetBasicsToolPaths,
}))

vi.mock(import('../../../../src/util/sea/detect.mts'), () => ({
  isSeaBinary: mockIsSeaBinary,
}))

vi.mock(import('../../../../src/util/socket/api.mts'), () => ({
  socketHttpRequest: mockSocketHttpRequest,
}))

vi.mock(import('../../../../src/env/python-version.mts'), () => ({
  getPythonVersion: mockGetPythonVersion,
}))

vi.mock(import('../../../../src/env/python-build-tag.mts'), () => ({
  getPythonBuildTag: mockGetPythonBuildTag,
}))

vi.mock(import('../../../../src/env/python-checksums.mts'), () => ({
  requirePythonChecksum: mockRequirePythonChecksum,
}))

import {
  ensurePython,
  ensurePythonDlx,
} from '../../../../src/util/dlx/spawn-pycli.mts'

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

describe('ensurePython', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSocketCliPythonPath = undefined
    mockIsSeaBinary.mockReturnValue(false)
    mockAreBasicsToolsAvailable.mockReturnValue(false)
  })

  it('returns SOCKET_CLI_PYTHON_PATH when set', async () => {
    mockSocketCliPythonPath = '/local/python'
    const result = await ensurePython()
    expect(result).toBe('/local/python')
  })

  it('uses bundled Python from VFS in SEA mode', async () => {
    mockIsSeaBinary.mockReturnValue(true)
    mockAreBasicsToolsAvailable.mockReturnValue(true)
    mockExtractBasicsTools.mockResolvedValue('/sea/tools' as never)
    mockGetBasicsToolPaths.mockReturnValue({ python: '/sea/python' })

    const result = await ensurePython()
    expect(result).toBe('/sea/python')
  })

  it('falls through to ensurePythonDlx when SEA but extractBasicsTools returns null', async () => {
    mockIsSeaBinary.mockReturnValue(true)
    mockAreBasicsToolsAvailable.mockReturnValue(true)
    mockExtractBasicsTools.mockResolvedValue(undefined)
    // Make ensurePythonDlx short-circuit by claiming binary exists.
    mockExistsSync.mockReturnValue(true)

    const result = await ensurePython()
    expect(result).toContain('python')
  })

  it('falls through to ensurePythonDlx when not in SEA mode', async () => {
    mockExistsSync.mockReturnValue(true)
    const result = await ensurePython()
    expect(result).toContain('python')
  })
})

describe('ensurePythonDlx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExistsSync.mockReturnValue(false)
    mockSafeMkdir.mockResolvedValue(undefined)
    mockSafeDelete.mockResolvedValue(undefined)
    mockFsWriteFile.mockResolvedValue(undefined)
    mockFsReadFile.mockResolvedValue('99999')
    mockFsChmod.mockResolvedValue(undefined)
    mockDownloadBinary.mockResolvedValue({ binaryPath: '/dl/python.tar.gz' })
    mockSpawn.mockResolvedValue({ stdout: '' })
    mockWhichReal.mockResolvedValue('/usr/bin/tar')
  })

  it('returns existing binary when already present', async () => {
    mockExistsSync.mockReturnValue(true)
    const result = await ensurePythonDlx()
    expect(result).toContain('python')
  })

  it('downloads, extracts, and chmods python when missing', async () => {
    // existsSync false initially → trigger download path, true after extraction.
    let calls = 0
    mockExistsSync.mockImplementation(() => {
      calls += 1
      return calls >= 2
    })

    const result = await ensurePythonDlx()
    expect(mockDownloadBinary).toHaveBeenCalled()
    expect(mockFsChmod).toHaveBeenCalled()
    expect(result).toContain('python')
  })

  it('throws when extracted python binary missing', async () => {
    mockExistsSync.mockReturnValue(false)
    await expect(ensurePythonDlx()).rejects.toThrow(/does not exist/)
  })

  it('throws when MAX_RETRIES exceeded', async () => {
    await expect(ensurePythonDlx(3)).rejects.toThrow(
      /could not acquire the Python install lock/,
    )
  })

  it('rethrows non-EEXIST write errors', async () => {
    mockExistsSync.mockReturnValue(false)
    mockFsWriteFile.mockRejectedValue(
      Object.assign(new Error('EACCES'), { code: 'EACCES' }),
    )
    await expect(ensurePythonDlx()).rejects.toThrow(/EACCES/)
  })

  it('waits for concurrent download and returns when binary appears', async () => {
    stubFastTimers()
    try {
      mockFsWriteFile.mockRejectedValue(
        Object.assign(new Error('EEXIST'), { code: 'EEXIST' }),
      )
      const realKill = process.kill
      ;(process as { kill: unknown }).kill = vi.fn(() => true)
      // existsSync: false on initial cache check, true on first wait-loop poll.
      let calls = 0
      mockExistsSync.mockImplementation(() => {
        calls += 1
        return calls >= 2
      })
      try {
        const result = await ensurePythonDlx()
        expect(result).toContain('python')
      } finally {
        ;(process as { kill: unknown }).kill = realKill
      }
    } finally {
      restoreTimers()
    }
  })

  it('times out after 60s waiting for concurrent download', async () => {
    stubFastTimers()
    try {
      mockFsWriteFile.mockRejectedValue(
        Object.assign(new Error('EEXIST'), { code: 'EEXIST' }),
      )
      const realKill = process.kill
      ;(process as { kill: unknown }).kill = vi.fn(() => true)
      // existsSync always false → timeout.
      mockExistsSync.mockReturnValue(false)
      try {
        await expect(ensurePythonDlx()).rejects.toThrow(/timed out/)
      } finally {
        ;(process as { kill: unknown }).kill = realKill
      }
    } finally {
      restoreTimers()
    }
  })

  it('handles stale lock (dead PID) and retries', async () => {
    let writeCount = 0
    mockFsWriteFile.mockImplementation(async () => {
      writeCount += 1
      if (writeCount === 1) {
        throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
      }
      return undefined
    })
    mockFsReadFile.mockResolvedValue('12345')
    const realKill = process.kill
    ;(process as { kill: unknown }).kill = vi.fn(() => {
      throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' })
    })
    // existsSync: false (cache check), false (still missing in retry's cache
    // check), then after download succeeds: true.
    let calls = 0
    mockExistsSync.mockImplementation(() => {
      calls += 1
      return calls >= 3
    })
    try {
      const result = await ensurePythonDlx()
      expect(result).toContain('python')
    } finally {
      ;(process as { kill: unknown }).kill = realKill
    }
  })

  it('treats invalid PID as stale lock and retries', async () => {
    let writeCount = 0
    mockFsWriteFile.mockImplementation(async () => {
      writeCount += 1
      if (writeCount === 1) {
        throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
      }
      return undefined
    })
    mockFsReadFile.mockResolvedValue('not-a-number')
    let calls = 0
    mockExistsSync.mockImplementation(() => {
      calls += 1
      return calls >= 3
    })
    const result = await ensurePythonDlx()
    expect(result).toContain('python')
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
    let calls = 0
    mockExistsSync.mockImplementation(() => {
      calls += 1
      return calls >= 3
    })
    const result = await ensurePythonDlx()
    expect(result).toContain('python')
  })

  it('treats EPERM kill error as alive process', async () => {
    stubFastTimers()
    try {
      mockFsWriteFile.mockRejectedValue(
        Object.assign(new Error('EEXIST'), { code: 'EEXIST' }),
      )
      const realKill = process.kill
      ;(process as { kill: unknown }).kill = vi.fn(() => {
        throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
      })
      // existsSync: false on initial, true on first poll.
      let calls = 0
      mockExistsSync.mockImplementation(() => {
        calls += 1
        return calls >= 2
      })
      try {
        const result = await ensurePythonDlx()
        expect(result).toContain('python')
      } finally {
        ;(process as { kill: unknown }).kill = realKill
      }
    } finally {
      restoreTimers()
    }
  })
})
