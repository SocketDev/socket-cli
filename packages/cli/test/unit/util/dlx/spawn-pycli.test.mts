/**
 * Unit tests for util/dlx/spawn-pycli.
 *
 * Covers convertCaretToPipRange, downloadPyPiWheel, downloadPython,
 * getPythonBinPath, getPythonCachePath, getPythonStandaloneInfo, and
 * isSocketPyCliInstalled.
 *
 * Related Files:
 *
 * - Src/util/dlx/spawn-pycli.mts
 * - Spawn-pycli-ensure.test.mts
 * - Spawn-pycli-ensure-socket-cli.test.mts
 * - Spawn-pycli-spawn.test.mts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const mockSocketCliPythonPath: string | undefined = undefined
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
  getPythonBinPath,
  getPythonCachePath,
  getPythonStandaloneInfo,
  isSocketPyCliInstalled,
} from '../../../../src/util/dlx/spawn-pycli.mts'

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
