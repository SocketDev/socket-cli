/**
 * Max-file-lines: legitimate — comprehensive single-module test suite. Covers
 * 13 entry points of src/util/dlx/spawn-pycli.mts (helpers + ensure* state
 * machines + spawn* dispatchers). Splitting would duplicate the ~130 lines of
 * vi.mock setup that every describe relies on; the mock contract IS the
 * test-file's cohesion.
 *
 * Unit tests for util/dlx/spawn-pycli.
 *
 * Covers convertCaretToPipRange, downloadPyPiWheel, downloadPython,
 * ensurePython, ensurePythonDlx, ensureSocketPyCli, getPythonBinPath,
 * getPythonCachePath, getPythonStandaloneInfo, isSocketPyCliInstalled,
 * spawnSocketPyCli, spawnSocketPyCliDlx, and spawnSocketPyCliVfs.
 *
 * Related Files:
 *
 * - Src/util/dlx/spawn-pycli.mts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as NodeFs from 'node:fs'

const mockSpawn = vi.hoisted(() => vi.fn())
const mockSpawnNode = vi.hoisted(() => vi.fn())
const mockDownloadBinary = vi.hoisted(() => vi.fn())
const mockGetDlxCachePath = vi.hoisted(() => vi.fn(() => '/tmp/dlx'))
const mockWhichReal = vi.hoisted(() => vi.fn(async () => '/usr/bin/tar'))
const mockSafeMkdir = vi.hoisted(() => vi.fn(async () => {}))
const mockSafeDelete = vi.hoisted(() => vi.fn(async () => {}))
const mockExistsSync = vi.hoisted(() => vi.fn(() => false))
const mockFsWriteFile = vi.hoisted(() => vi.fn(async () => {}))
const mockFsReadFile = vi.hoisted(() => vi.fn(async () => '99999'))
const mockFsCopyFile = vi.hoisted(() => vi.fn(async () => {}))
const mockFsChmod = vi.hoisted(() => vi.fn(async () => {}))
const mockResolvePyCli = vi.hoisted(() => vi.fn())
const mockAreBasicsToolsAvailable = vi.hoisted(() => vi.fn(() => false))
const mockExtractBasicsTools = vi.hoisted(() => vi.fn(async () => undefined))
const mockGetBasicsToolPaths = vi.hoisted(() =>
  vi.fn(() => ({ python: '/basics/python' })),
)
const mockIsSeaBinary = vi.hoisted(() => vi.fn(() => false))
const mockSocketHttpRequest = vi.hoisted(() => vi.fn())
const mockGetPyCliVersion = vi.hoisted(() => vi.fn(() => '2.3.4'))
const mockGetPyCliChecksums = vi.hoisted(() => vi.fn(() => ({})))
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
    copyFile: mockFsCopyFile,
    chmod: mockFsChmod,
  }
  return {
    ...actual,
    existsSync: mockExistsSync,
    promises,
    default: { ...actual, existsSync: mockExistsSync, promises },
  }
})

vi.mock(import('../../../../src/util/dlx/resolve-binary.mts'), () => ({
  resolvePyCli: mockResolvePyCli,
}))

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

vi.mock(import('../../../../src/util/spawn/spawn-node.mts'), () => ({
  spawnNode: mockSpawnNode,
}))

vi.mock(import('../../../../src/env/pycli-version.mts'), () => ({
  getPyCliVersion: mockGetPyCliVersion,
}))

vi.mock(import('../../../../src/env/pycli-checksums.mts'), () => ({
  getPyCliChecksums: mockGetPyCliChecksums,
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
  convertCaretToPipRange,
  downloadPyPiWheel,
  downloadPython,
  ensurePython,
  ensurePythonDlx,
  ensureSocketPyCli,
  getPythonBinPath,
  getPythonCachePath,
  getPythonStandaloneInfo,
  isSocketPyCliInstalled,
  spawnSocketPyCli,
  spawnSocketPyCliDlx,
  spawnSocketPyCliVfs,
} from '../../../../src/util/dlx/spawn-pycli.mts'

const realSetTimeout = globalThis.setTimeout
function stubFastTimers() {
  ;(globalThis as { setTimeout: unknown }).setTimeout = ((cb: () => void) => {
    cb()
    return 0 as never
  }) as never
}
function restoreTimers() {
  ;(globalThis as { setTimeout: unknown }).setTimeout = realSetTimeout
}

describe('convertCaretToPipRange', () => {
  it('returns empty string for empty input', () => {
    expect(convertCaretToPipRange('')).toBe('')
  })

  it('returns ==<version> for non-caret input', () => {
    expect(convertCaretToPipRange('1.2.3')).toBe('==1.2.3')
  })

  it('converts ^1.2.3 to >=1.2.3,<2.0.0', () => {
    expect(convertCaretToPipRange('^1.2.3')).toBe('>=1.2.3,<2.0.0')
  })

  it('returns empty string for malformed "^" alone', () => {
    expect(convertCaretToPipRange('^')).toBe('')
  })

  it('returns ==<version> for non-numeric major in caret range', () => {
    expect(convertCaretToPipRange('^x.2.3')).toBe('==x.2.3')
  })

  it('handles caret with single-digit version', () => {
    expect(convertCaretToPipRange('^2')).toBe('>=2,<3.0.0')
  })
})

describe('getPythonBinPath', () => {
  it('returns POSIX bin path', () => {
    const result = getPythonBinPath('/cache/py')
    expect(result).toMatch(/python\/bin\/python3$/)
  })
})

describe('getPythonCachePath', () => {
  it('returns a path containing python version + platform', () => {
    const result = getPythonCachePath()
    expect(result).toContain('python')
    expect(result).toContain('3.12.0')
  })
})

describe('getPythonStandaloneInfo', () => {
  it('throws for unsupported platform', () => {
    const orig = process.platform
    Object.defineProperty(process, 'platform', {
      value: 'sunos',
      configurable: true,
    })
    try {
      expect(() => getPythonStandaloneInfo()).toThrow(
        /python-build-standalone does not ship a prebuilt/,
      )
    } finally {
      Object.defineProperty(process, 'platform', {
        value: orig,
        configurable: true,
      })
    }
  })

  it('returns darwin info', () => {
    const orig = process.platform
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
    })
    try {
      const info = getPythonStandaloneInfo()
      expect(info.url).toContain('apple-darwin')
      expect(info.assetName).toMatch(/install_only\.tar\.gz$/)
    } finally {
      Object.defineProperty(process, 'platform', {
        value: orig,
        configurable: true,
      })
    }
  })

  it('returns linux info', () => {
    const origPlat = process.platform
    const origArch = process.arch
    Object.defineProperty(process, 'platform', {
      value: 'linux',
      configurable: true,
    })
    Object.defineProperty(process, 'arch', {
      value: 'x64',
      configurable: true,
    })
    try {
      const info = getPythonStandaloneInfo()
      expect(info.url).toContain('linux-gnu')
    } finally {
      Object.defineProperty(process, 'platform', {
        value: origPlat,
        configurable: true,
      })
      Object.defineProperty(process, 'arch', {
        value: origArch,
        configurable: true,
      })
    }
  })

  it('returns linux arm64 info', () => {
    const origPlat = process.platform
    const origArch = process.arch
    Object.defineProperty(process, 'platform', {
      value: 'linux',
      configurable: true,
    })
    Object.defineProperty(process, 'arch', {
      value: 'arm64',
      configurable: true,
    })
    try {
      const info = getPythonStandaloneInfo()
      expect(info.url).toContain('aarch64-unknown-linux-gnu')
    } finally {
      Object.defineProperty(process, 'platform', {
        value: origPlat,
        configurable: true,
      })
      Object.defineProperty(process, 'arch', {
        value: origArch,
        configurable: true,
      })
    }
  })

  it('returns darwin x64 info', () => {
    const origPlat = process.platform
    const origArch = process.arch
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
    })
    Object.defineProperty(process, 'arch', {
      value: 'x64',
      configurable: true,
    })
    try {
      const info = getPythonStandaloneInfo()
      expect(info.url).toContain('x86_64-apple-darwin')
    } finally {
      Object.defineProperty(process, 'platform', {
        value: origPlat,
        configurable: true,
      })
      Object.defineProperty(process, 'arch', {
        value: origArch,
        configurable: true,
      })
    }
  })

  it('returns win32 info', () => {
    const origPlat = process.platform
    const origArch = process.arch
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
    })
    Object.defineProperty(process, 'arch', {
      value: 'x64',
      configurable: true,
    })
    try {
      const info = getPythonStandaloneInfo()
      expect(info.url).toContain('windows-msvc')
    } finally {
      Object.defineProperty(process, 'platform', {
        value: origPlat,
        configurable: true,
      })
      Object.defineProperty(process, 'arch', {
        value: origArch,
        configurable: true,
      })
    }
  })

  it('returns win32 arm64 info', () => {
    const origPlat = process.platform
    const origArch = process.arch
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
    })
    Object.defineProperty(process, 'arch', {
      value: 'arm64',
      configurable: true,
    })
    try {
      const info = getPythonStandaloneInfo()
      expect(info.url).toContain('aarch64-pc-windows-msvc')
    } finally {
      Object.defineProperty(process, 'platform', {
        value: origPlat,
        configurable: true,
      })
      Object.defineProperty(process, 'arch', {
        value: origArch,
        configurable: true,
      })
    }
  })
})

describe('downloadPyPiWheel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExistsSync.mockReturnValue(false)
    mockSafeMkdir.mockResolvedValue(undefined)
    mockFsCopyFile.mockResolvedValue(undefined)
    mockDownloadBinary.mockResolvedValue({ binaryPath: '/dl/wheel' })
  })

  it('returns cached wheel path when already present', async () => {
    mockExistsSync.mockReturnValue(true)
    const result = await downloadPyPiWheel('pkg', '1.0.0', 'sha')
    expect(result).toContain('pkg-1.0.0-py3-none-any.whl')
    expect(mockSocketHttpRequest).not.toHaveBeenCalled()
  })

  it('throws InputError when PyPI returns non-ok response', async () => {
    mockSocketHttpRequest.mockResolvedValue({
      ok: false,
      status: 404,
      json: () => ({}),
    })
    await expect(downloadPyPiWheel('pkg', '1.0.0', 'sha')).rejects.toThrow(
      /could not fetch PyPI metadata/,
    )
  })

  it('throws InputError when network request fails', async () => {
    mockSocketHttpRequest.mockRejectedValue(new Error('ECONNRESET'))
    await expect(downloadPyPiWheel('pkg', '1.0.0', 'sha')).rejects.toThrow(
      /could not fetch PyPI metadata/,
    )
  })

  it('throws when no py3-none-any wheel is available', async () => {
    mockSocketHttpRequest.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => ({ urls: [{ filename: 'pkg.tar.gz', url: 'http://x' }] }),
    })
    await expect(downloadPyPiWheel('pkg', '1.0.0', 'sha')).rejects.toThrow(
      /has no py3-none-any wheel/,
    )
  })

  it('downloads, verifies, and copies wheel to cache', async () => {
    mockSocketHttpRequest.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => ({
        urls: [{ filename: 'pkg-1.0.0-py3-none-any.whl', url: 'http://x' }],
      }),
    })

    const result = await downloadPyPiWheel('pkg', '1.0.0', 'sha')
    expect(mockDownloadBinary).toHaveBeenCalled()
    expect(mockFsCopyFile).toHaveBeenCalled()
    expect(result).toContain('pkg-1.0.0-py3-none-any.whl')
  })

  it('falls back to any .whl when no py3-none-any present', async () => {
    mockSocketHttpRequest.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => ({
        urls: [{ filename: 'pkg-1.0.0-anywhere.whl', url: 'http://x' }],
      }),
    })
    const result = await downloadPyPiWheel('pkg', '1.0.0', undefined)
    expect(result).toContain('pkg-1.0.0-py3-none-any.whl')
  })
})

describe('downloadPython', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSafeMkdir.mockResolvedValue(undefined)
    mockDownloadBinary.mockResolvedValue({ binaryPath: '/dl/python.tar.gz' })
    mockSpawn.mockResolvedValue({ stdout: '' })
    mockWhichReal.mockResolvedValue('/usr/bin/tar')
    Object.defineProperty(process, 'platform', {
      value: 'linux',
      configurable: true,
    })
    Object.defineProperty(process, 'arch', {
      value: 'x64',
      configurable: true,
    })
  })

  it('throws when tar is not on PATH', async () => {
    mockWhichReal.mockResolvedValue(undefined)
    await expect(downloadPython('/dest')).rejects.toThrow(/tar is required/)
  })

  it('throws when whichReal returns array (multiple match)', async () => {
    mockWhichReal.mockResolvedValue(['/a', '/b'] as never)
    await expect(downloadPython('/dest')).rejects.toThrow(/tar is required/)
  })

  it('downloads and extracts python', async () => {
    await downloadPython('/dest')
    expect(mockDownloadBinary).toHaveBeenCalled()
    expect(mockSpawn).toHaveBeenCalledWith(
      '/usr/bin/tar',
      ['-xzf', '/dl/python.tar.gz', '-C', '/dest'],
      expect.any(Object),
    )
  })
})

describe('isSocketPyCliInstalled', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns true when import check succeeds (code 0)', async () => {
    mockSpawn.mockResolvedValue({ code: 0 })
    const result = await isSocketPyCliInstalled('/python')
    expect(result).toBe(true)
  })

  it('returns false when import check returns non-zero code', async () => {
    mockSpawn.mockResolvedValue({ code: 1 })
    const result = await isSocketPyCliInstalled('/python')
    expect(result).toBe(false)
  })

  it('returns false when spawn throws', async () => {
    mockSpawn.mockRejectedValue(new Error('spawn failure'))
    const result = await isSocketPyCliInstalled('/python')
    expect(result).toBe(false)
  })
})

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
    mockGetBasicsToolPaths.mockReturnValue({ python: '/sea/python' } as never)

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
      const realKill = process.kill
      ;(process as { kill: unknown }).kill = vi.fn(() => true)
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
        ;(process as { kill: unknown }).kill = realKill
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
    const realKill = process.kill
    ;(process as { kill: unknown }).kill = vi.fn(() => {
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
      ;(process as { kill: unknown }).kill = realKill
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
      const realKill = process.kill
      let killCount = 0
      ;(process as { kill: unknown }).kill = vi.fn(() => {
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
        ;(process as { kill: unknown }).kill = realKill
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
      const realKill = process.kill
      ;(process as { kill: unknown }).kill = vi.fn(() => true)
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
        ;(process as { kill: unknown }).kill = realKill
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
      const realKill = process.kill
      let killCount = 0
      ;(process as { kill: unknown }).kill = vi.fn(() => {
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
        ;(process as { kill: unknown }).kill = realKill
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
      const realKill = process.kill
      ;(process as { kill: unknown }).kill = vi.fn(() => true)
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
        ;(process as { kill: unknown }).kill = realKill
      }
    } finally {
      restoreTimers()
    }
  })
})

describe('spawnSocketPyCli', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSocketCliPythonPath = undefined
    mockIsSeaBinary.mockReturnValue(false)
    mockAreBasicsToolsAvailable.mockReturnValue(false)
    mockExistsSync.mockReturnValue(true)
    mockSpawn.mockResolvedValue({ stdout: Buffer.from('out'), code: 0 })
    mockSpawnNode.mockResolvedValue({ stdout: Buffer.from('node-out') })
    mockResolvePyCli.mockReturnValue({ type: 'python' })
  })

  it('runs local resolution path via spawnNode', async () => {
    mockResolvePyCli.mockReturnValue({ type: 'local', path: '/local/py' })
    const result = await spawnSocketPyCli(['scan'])
    expect(mockSpawnNode).toHaveBeenCalledWith(
      ['/local/py', 'scan'],
      expect.any(Object),
    )
    expect(result.ok).toBe(true)
  })

  it('runs local resolution with cwd from options', async () => {
    mockResolvePyCli.mockReturnValue({ type: 'local', path: '/local/py' })
    await spawnSocketPyCli(['scan'], { cwd: '/wd' })
    expect(mockSpawnNode).toHaveBeenCalledWith(
      ['/local/py', 'scan'],
      expect.objectContaining({ cwd: '/wd' }),
    )
  })

  it('uses ensurePython + ensureSocketPyCli + spawn for non-local resolution', async () => {
    mockResolvePyCli.mockReturnValue({ type: 'python' })
    mockSpawn.mockResolvedValue({ stdout: Buffer.from('ok'), code: 0 })

    const result = await spawnSocketPyCli(['x'])
    expect(result.ok).toBe(true)
  })

  it('builds isolated PATH when SEA + basics tools available', async () => {
    mockResolvePyCli.mockReturnValue({ type: 'python' })
    mockIsSeaBinary.mockReturnValue(true)
    mockAreBasicsToolsAvailable.mockReturnValue(true)
    mockExtractBasicsTools.mockResolvedValue('/sea/tools' as never)
    mockGetBasicsToolPaths.mockReturnValue({ python: '/sea/python' } as never)
    mockSpawn.mockResolvedValue({ stdout: Buffer.from('ok'), code: 0 })

    await spawnSocketPyCli(['x'])
    // The final spawn call should include a PATH env.
    const lastCall = mockSpawn.mock.calls[mockSpawn.mock.calls.length - 1]
    expect(lastCall[2].env.PATH).toBeTruthy()
  })

  it('returns ok:false when spawn throws', async () => {
    mockResolvePyCli.mockReturnValue({ type: 'local', path: '/local/py' })
    mockSpawnNode.mockRejectedValue(new Error('boom'))
    const result = await spawnSocketPyCli([])
    expect(result.ok).toBe(false)
  })
})

describe('spawnSocketPyCliDlx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExistsSync.mockReturnValue(true)
    mockSpawn.mockResolvedValue({ stdout: Buffer.from('ok'), code: 0 })
    mockSpawnNode.mockResolvedValue({ stdout: Buffer.from('node-out') })
  })

  it('runs local resolution via spawnNode', async () => {
    mockResolvePyCli.mockReturnValue({ type: 'local', path: '/local/py' })
    const result = await spawnSocketPyCliDlx(['x'])
    expect(mockSpawnNode).toHaveBeenCalled()
    expect(result.ok).toBe(true)
  })

  it('runs local resolution with cwd', async () => {
    mockResolvePyCli.mockReturnValue({ type: 'local', path: '/local/py' })
    await spawnSocketPyCliDlx([], { cwd: '/wd' })
    expect(mockSpawnNode).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ cwd: '/wd' }),
    )
  })

  it('uses ensurePythonDlx for non-local resolution', async () => {
    mockResolvePyCli.mockReturnValue({ type: 'python' })
    const result = await spawnSocketPyCliDlx([])
    expect(result.ok).toBe(true)
  })

  it('returns ok:false on error', async () => {
    mockResolvePyCli.mockReturnValue({ type: 'local', path: '/local/py' })
    mockSpawnNode.mockRejectedValue(new Error('boom'))
    const result = await spawnSocketPyCliDlx([])
    expect(result.ok).toBe(false)
  })
})

describe('spawnSocketPyCliVfs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExistsSync.mockReturnValue(false)
    mockSpawn.mockResolvedValue({ stdout: Buffer.from('ok') })
    mockGetPyCliVersion.mockReturnValue('1.2.3')
    mockGetPyCliChecksums.mockReturnValue({})
    mockSocketHttpRequest.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => ({
        urls: [{ filename: 'wheel.whl', url: 'http://x' }],
      }),
    })
    mockDownloadBinary.mockResolvedValue({ binaryPath: '/dl' })
    mockFsCopyFile.mockResolvedValue(undefined)
  })

  it('returns ok:false when extractBasicsTools returns null', async () => {
    mockExtractBasicsTools.mockResolvedValue(undefined)
    const result = await spawnSocketPyCliVfs([])
    expect(result.ok).toBe(false)
  })

  it('runs full flow without checksums (dev mode)', async () => {
    mockExtractBasicsTools.mockResolvedValue('/sea/tools' as never)
    mockGetBasicsToolPaths.mockReturnValue({ python: '/sea/python' } as never)
    const result = await spawnSocketPyCliVfs(['x'])
    expect(result.ok).toBe(true)
  })

  it('runs full flow with checksums (verified wheel)', async () => {
    mockGetPyCliChecksums.mockReturnValue({
      'socketsecurity-1.2.3-py3-none-any.whl': 'sha',
    })
    mockExistsSync.mockReturnValue(true)
    mockExtractBasicsTools.mockResolvedValue('/sea/tools' as never)
    mockGetBasicsToolPaths.mockReturnValue({ python: '/sea/python' } as never)
    const result = await spawnSocketPyCliVfs(['x'])
    expect(result.ok).toBe(true)
  })

  it('throws when checksum present but wheel download fails', async () => {
    mockGetPyCliChecksums.mockReturnValue({
      'socketsecurity-1.2.3-py3-none-any.whl': 'sha',
    })
    mockSocketHttpRequest.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => ({ urls: [] }),
    })
    mockExtractBasicsTools.mockResolvedValue('/sea/tools' as never)
    mockGetBasicsToolPaths.mockReturnValue({ python: '/sea/python' } as never)

    const result = await spawnSocketPyCliVfs(['x'])
    expect(result.ok).toBe(false)
  })

  it('returns ok:false when spawn throws during install', async () => {
    mockExtractBasicsTools.mockResolvedValue('/sea/tools' as never)
    mockGetBasicsToolPaths.mockReturnValue({ python: '/sea/python' } as never)
    mockSpawn.mockRejectedValue(new Error('boom'))
    const result = await spawnSocketPyCliVfs([])
    expect(result.ok).toBe(false)
  })
})
