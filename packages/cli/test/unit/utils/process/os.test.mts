/**
 * Unit tests for platform detection utilities.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getBinaryName,
  getBinaryRelativePath,
  getNpmArch,
  getNpmPlatform,
  getSocketbinPackageName,
} from '../../../../src/src/os.mts'

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

  it('should return correct package name for Linux ARM64', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('arm64')
    expect(getSocketbinPackageName()).toBe('@socketbin/cli-linux-arm64')
  })

  it('should return correct package name for Linux x64', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('x64')
    expect(getSocketbinPackageName()).toBe('@socketbin/cli-linux-x64')
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
