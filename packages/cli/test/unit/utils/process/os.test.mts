/**
 * Unit tests for platform detection utilities.
 */

import * as fs from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearQuarantine,
  detectMusl,
  ensureExecutable,
  getArchName,
  getBinaryName,
  getBinaryRelativePath,
  getExpectedAssetName,
  getLibcSuffix,
  getNpmArch,
  getNpmPlatform,
  getPlatformName,
  getSocketbinPackageName,
  isPlatformSupported,
  resetLibcCache,
} from '../../../../src/utils/process/os.mts'

// Mock spawn for clearQuarantine tests.
vi.mock('@socketsecurity/lib/spawn', () => ({
  spawn: vi.fn(),
}))

// Mock the fs module.
vi.mock('node:fs', async () => {
  const actual = await vi.importActual('node:fs')
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  }
})

describe('detectMusl', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    resetLibcCache()
  })

  afterEach(() => {
    resetLibcCache()
  })

  it('should return false on non-Linux platforms', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    expect(detectMusl()).toBe(false)
  })

  it('should return false on Windows', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    expect(detectMusl()).toBe(false)
  })

  it('should detect Alpine Linux via /etc/os-release', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    vi.mocked(fs.existsSync).mockImplementation((path: unknown) => {
      return path === '/etc/os-release'
    })
    vi.mocked(fs.readFileSync).mockImplementation((path: unknown) => {
      if (path === '/etc/os-release') {
        return 'NAME="Alpine Linux"\nID=alpine\nVERSION_ID=3.18.0'
      }
      throw new Error('File not found')
    })
    expect(detectMusl()).toBe(true)
  })

  it('should detect musl via ld-musl dynamic linker (x86_64)', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    vi.mocked(fs.existsSync).mockImplementation((path: unknown) => {
      return path === '/lib/ld-musl-x86_64.so.1'
    })
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('File not found')
    })
    expect(detectMusl()).toBe(true)
  })

  it('should detect musl via ld-musl dynamic linker (aarch64)', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    vi.mocked(fs.existsSync).mockImplementation((path: unknown) => {
      return path === '/lib/ld-musl-aarch64.so.1'
    })
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('File not found')
    })
    expect(detectMusl()).toBe(true)
  })

  it('should return false for glibc-based Linux', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    vi.mocked(fs.existsSync).mockImplementation((path: unknown) => {
      // Only /etc/os-release and /proc/version exist.
      return path === '/etc/os-release' || path === '/proc/version'
    })
    vi.mocked(fs.readFileSync).mockImplementation((path: unknown) => {
      if (path === '/etc/os-release') {
        return 'NAME="Ubuntu"\nID=ubuntu\nVERSION_ID="22.04"'
      }
      if (path === '/proc/version') {
        return 'Linux version 5.15.0-91-generic (buildd@ubuntu) (gcc (Ubuntu 11.4.0-1ubuntu1~22.04))'
      }
      throw new Error('File not found')
    })
    expect(detectMusl()).toBe(false)
  })

  it('should cache the result', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    let existsSyncCallCount = 0
    vi.mocked(fs.existsSync).mockImplementation((path: unknown) => {
      existsSyncCallCount++
      return path === '/etc/os-release'
    })
    vi.mocked(fs.readFileSync).mockImplementation((path: unknown) => {
      if (path === '/etc/os-release') {
        return 'NAME="Alpine Linux"'
      }
      throw new Error('File not found')
    })

    // Call twice.
    detectMusl()
    detectMusl()

    // existsSync should only be called once (cached after first call).
    expect(existsSyncCallCount).toBe(1)
  })
})

describe('getLibcSuffix', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    resetLibcCache()
  })

  afterEach(() => {
    resetLibcCache()
  })

  it('should return empty string on non-Linux', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    expect(getLibcSuffix()).toBe('')
  })

  it('should return -musl on Alpine', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    vi.mocked(fs.existsSync).mockImplementation((path: unknown) => {
      return path === '/etc/os-release'
    })
    vi.mocked(fs.readFileSync).mockImplementation((path: unknown) => {
      if (path === '/etc/os-release') {
        return 'ID=alpine'
      }
      throw new Error('File not found')
    })
    expect(getLibcSuffix()).toBe('-musl')
  })

  it('should return empty string on glibc Linux', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    vi.mocked(fs.existsSync).mockReturnValue(false)
    expect(getLibcSuffix()).toBe('')
  })
})

describe('getNpmPlatform', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('should map darwin to darwin', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    expect(getNpmPlatform()).toBe('darwin')
  })

  it('should map linux to linux', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    expect(getNpmPlatform()).toBe('linux')
  })

  it('should map win32 to win32', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    expect(getNpmPlatform()).toBe('win32')
  })
})

describe('getNpmArch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('should map arm64 to arm64', () => {
    vi.spyOn(process, 'arch', 'get').mockReturnValue('arm64')
    expect(getNpmArch()).toBe('arm64')
  })

  it('should map x64 to x64', () => {
    vi.spyOn(process, 'arch', 'get').mockReturnValue('x64')
    expect(getNpmArch()).toBe('x64')
  })
})

describe('getSocketbinPackageName', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    resetLibcCache()
    // Default mock for non-musl systems.
    vi.mocked(fs.existsSync).mockReturnValue(false)
  })

  afterEach(() => {
    resetLibcCache()
  })

  it('should return correct package name for macOS ARM64', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('arm64')
    expect(getSocketbinPackageName()).toBe('@socketbin/cli-darwin-arm64')
  })

  it('should return correct package name for macOS x64', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('x64')
    expect(getSocketbinPackageName()).toBe('@socketbin/cli-darwin-x64')
  })

  it('should return correct package name for Linux ARM64 (glibc)', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('arm64')
    expect(getSocketbinPackageName()).toBe('@socketbin/cli-linux-arm64')
  })

  it('should return correct package name for Linux x64 (glibc)', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('x64')
    expect(getSocketbinPackageName()).toBe('@socketbin/cli-linux-x64')
  })

  it('should return correct package name for Linux ARM64 (musl/Alpine)', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('arm64')
    vi.mocked(fs.existsSync).mockImplementation((path: unknown) => {
      return path === '/lib/ld-musl-aarch64.so.1'
    })
    expect(getSocketbinPackageName()).toBe('@socketbin/cli-linux-arm64-musl')
  })

  it('should return correct package name for Linux x64 (musl/Alpine)', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('x64')
    vi.mocked(fs.existsSync).mockImplementation((path: unknown) => {
      return path === '/lib/ld-musl-x86_64.so.1'
    })
    expect(getSocketbinPackageName()).toBe('@socketbin/cli-linux-x64-musl')
  })

  it('should return correct package name for Windows x64', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('x64')
    expect(getSocketbinPackageName()).toBe('@socketbin/cli-win32-x64')
  })

  it('should return correct package name for Windows ARM64', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('arm64')
    expect(getSocketbinPackageName()).toBe('@socketbin/cli-win32-arm64')
  })
})

describe('getBinaryName', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('should return socket on Unix (macOS)', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    expect(getBinaryName()).toBe('socket')
  })

  it('should return socket on Unix (Linux)', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    expect(getBinaryName()).toBe('socket')
  })

  it('should return socket.exe on Windows', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    expect(getBinaryName()).toBe('socket.exe')
  })
})

describe('getBinaryRelativePath', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('should return bin/socket on Unix', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    expect(getBinaryRelativePath()).toBe('bin/socket')
  })

  it('should return bin/socket.exe on Windows', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    expect(getBinaryRelativePath()).toBe('bin/socket.exe')
  })
})

describe('getPlatformName', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('should map darwin to macos', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    expect(getPlatformName()).toBe('macos')
  })

  it('should map linux to linux', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    expect(getPlatformName()).toBe('linux')
  })

  it('should map win32 to win', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    expect(getPlatformName()).toBe('win')
  })

  it('should return unknown platform as-is', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('freebsd' as NodeJS.Platform)
    expect(getPlatformName()).toBe('freebsd')
  })
})

describe('getArchName', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('should map arm64 to arm64', () => {
    vi.spyOn(process, 'arch', 'get').mockReturnValue('arm64')
    expect(getArchName()).toBe('arm64')
  })

  it('should map x64 to x64', () => {
    vi.spyOn(process, 'arch', 'get').mockReturnValue('x64')
    expect(getArchName()).toBe('x64')
  })

  it('should return unknown arch as-is', () => {
    vi.spyOn(process, 'arch', 'get').mockReturnValue('ia32')
    expect(getArchName()).toBe('ia32')
  })
})

describe('getExpectedAssetName', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('should return correct asset name for macOS ARM64', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('arm64')
    expect(getExpectedAssetName()).toBe('socket-macos-arm64')
  })

  it('should return correct asset name for macOS x64', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('x64')
    expect(getExpectedAssetName()).toBe('socket-macos-x64')
  })

  it('should return correct asset name for Linux x64', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('x64')
    expect(getExpectedAssetName()).toBe('socket-linux-x64')
  })

  it('should return correct asset name for Linux ARM64', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('arm64')
    expect(getExpectedAssetName()).toBe('socket-linux-arm64')
  })

  it('should include .exe extension for Windows', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('x64')
    expect(getExpectedAssetName()).toBe('socket-win-x64.exe')
  })
})

describe('isPlatformSupported', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('should return true for macOS ARM64', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('arm64')
    expect(isPlatformSupported()).toBe(true)
  })

  it('should return true for macOS x64', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('x64')
    expect(isPlatformSupported()).toBe(true)
  })

  it('should return true for Linux x64', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('x64')
    expect(isPlatformSupported()).toBe(true)
  })

  it('should return true for Linux ARM64', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('arm64')
    expect(isPlatformSupported()).toBe(true)
  })

  it('should return true for Windows x64', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('x64')
    expect(isPlatformSupported()).toBe(true)
  })

  it('should return false for Windows ARM64', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('arm64')
    expect(isPlatformSupported()).toBe(false)
  })

  it('should return false for unsupported platforms', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('freebsd' as NodeJS.Platform)
    vi.spyOn(process, 'arch', 'get').mockReturnValue('x64')
    expect(isPlatformSupported()).toBe(false)
  })

  it('should return false for unsupported architectures', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('ia32')
    expect(isPlatformSupported()).toBe(false)
  })
})

describe('clearQuarantine', () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('should do nothing on non-macOS platforms', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    const spawnModule = await import('@socketsecurity/lib/spawn')
    const spawnMock = vi.mocked(spawnModule.spawn)

    await clearQuarantine('/path/to/file')

    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('should do nothing on Windows', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const spawnModule = await import('@socketsecurity/lib/spawn')
    const spawnMock = vi.mocked(spawnModule.spawn)

    await clearQuarantine('/path/to/file')

    expect(spawnMock).not.toHaveBeenCalled()
  })
})

describe('ensureExecutable', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('should do nothing on Windows', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')

    // Should not throw.
    await ensureExecutable('/path/to/file')
  })
})
