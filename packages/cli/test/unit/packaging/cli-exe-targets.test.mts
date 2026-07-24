import { describe, expect, it } from 'vitest'

import {
  CLI_EXE_TRIPLETS,
  cliExeBinaryName,
  cliExeEngineFields,
  cliExeManifest,
  cliExePackageName,
  cliExeUnscopedName,
  isCliExeTriplet,
  legacySocketbinPackageName,
  tripletFromParts,
} from 'package-builder/scripts/cli-exe-targets.mts'

describe('cli-exe-targets', () => {
  it('ships exactly the eight pack-app triplets in ASCII order', () => {
    expect(CLI_EXE_TRIPLETS).toEqual([
      'darwin-arm64',
      'darwin-x64',
      'linux-arm64',
      'linux-arm64-musl',
      'linux-x64',
      'linux-x64-musl',
      'win32-arm64',
      'win32-x64',
    ])
  })

  describe('tripletFromParts', () => {
    it('maps platform + arch to a triplet', () => {
      expect(tripletFromParts('darwin', 'arm64')).toBe('darwin-arm64')
      expect(tripletFromParts('linux', 'x64')).toBe('linux-x64')
      expect(tripletFromParts('win32', 'x64')).toBe('win32-x64')
    })

    it('applies the musl qualifier on linux only', () => {
      expect(tripletFromParts('linux', 'x64', 'musl')).toBe('linux-x64-musl')
      expect(tripletFromParts('linux', 'arm64', 'musl')).toBe(
        'linux-arm64-musl',
      )
      expect(tripletFromParts('darwin', 'arm64', 'musl')).toBe('darwin-arm64')
      expect(tripletFromParts('win32', 'x64', 'musl')).toBe('win32-x64')
    })

    it('keeps win32 spelled out — no legacy win normalization', () => {
      expect(tripletFromParts('win32', 'arm64')).toBe('win32-arm64')
      expect(tripletFromParts('win', 'arm64')).toBeUndefined()
    })

    it('returns undefined for unsupported platforms and arches', () => {
      expect(tripletFromParts('sunos', 'x64')).toBeUndefined()
      expect(tripletFromParts('linux', 'ia32')).toBeUndefined()
    })
  })

  describe('names', () => {
    it('builds dotted .exe names under @socketsecurity', () => {
      expect(cliExePackageName('darwin-arm64')).toBe(
        '@socketsecurity/cli.exe.darwin-arm64',
      )
      expect(cliExePackageName('linux-x64-musl')).toBe(
        '@socketsecurity/cli.exe.linux-x64-musl',
      )
      expect(cliExeUnscopedName('win32-x64')).toBe('cli.exe.win32-x64')
    })

    it('suffixes the binary .exe on windows only', () => {
      expect(cliExeBinaryName('win32-arm64')).toBe('socket.exe')
      expect(cliExeBinaryName('win32-x64')).toBe('socket.exe')
      expect(cliExeBinaryName('darwin-arm64')).toBe('socket')
      expect(cliExeBinaryName('linux-x64-musl')).toBe('socket')
    })

    it('guards triplet membership', () => {
      expect(isCliExeTriplet('linux-arm64-musl')).toBe(true)
      expect(isCliExeTriplet('linux-arm64-gnu')).toBe(false)
      expect(isCliExeTriplet('win-x64')).toBe(false)
      expect(isCliExeTriplet(undefined)).toBe(false)
    })
  })

  describe('legacySocketbinPackageName', () => {
    it('maps to the frozen names that actually contain binaries', () => {
      expect(legacySocketbinPackageName('darwin-arm64')).toBe(
        '@socketbin/cli-darwin-arm64',
      )
      expect(legacySocketbinPackageName('linux-x64')).toBe(
        '@socketbin/cli-linux-x64',
      )
    })

    it('maps musl to the alpine legacy names, not the empty cli-linux-*-musl placeholders', () => {
      expect(legacySocketbinPackageName('linux-x64-musl')).toBe(
        '@socketbin/cli-alpine-x64',
      )
      expect(legacySocketbinPackageName('linux-arm64-musl')).toBe(
        '@socketbin/cli-alpine-arm64',
      )
    })

    it('maps windows to the win32 legacy names, not the empty cli-win-* placeholders', () => {
      expect(legacySocketbinPackageName('win32-x64')).toBe(
        '@socketbin/cli-win32-x64',
      )
      expect(legacySocketbinPackageName('win32-arm64')).toBe(
        '@socketbin/cli-win32-arm64',
      )
    })
  })

  describe('cliExeEngineFields', () => {
    it('stamps os + cpu for every triplet', () => {
      expect(cliExeEngineFields('darwin-x64')).toEqual({
        cpu: ['x64'],
        os: ['darwin'],
      })
      expect(cliExeEngineFields('win32-arm64')).toEqual({
        cpu: ['arm64'],
        os: ['win32'],
      })
    })

    it('stamps libc on linux — glibc explicit, musl on musl tails', () => {
      expect(cliExeEngineFields('linux-arm64')).toEqual({
        cpu: ['arm64'],
        libc: ['glibc'],
        os: ['linux'],
      })
      expect(cliExeEngineFields('linux-x64-musl')).toEqual({
        cpu: ['x64'],
        libc: ['musl'],
        os: ['linux'],
      })
    })
  })

  describe('cliExeManifest', () => {
    it('carries the dotted name, bin payload, and engine fields', () => {
      const manifest = cliExeManifest('linux-arm64-musl')
      expect(manifest['name']).toBe('@socketsecurity/cli.exe.linux-arm64-musl')
      expect(manifest['bin']).toEqual({ socket: 'bin/socket' })
      expect(manifest['files']).toEqual(['bin/socket'])
      expect(manifest['os']).toEqual(['linux'])
      expect(manifest['cpu']).toEqual(['arm64'])
      expect(manifest['libc']).toEqual(['musl'])
      expect(manifest['private']).toBe(true)
    })

    it('points bin at socket.exe on windows and omits libc off linux', () => {
      const manifest = cliExeManifest('win32-x64')
      expect(manifest['bin']).toEqual({ socket: 'bin/socket.exe' })
      expect(manifest['files']).toEqual(['bin/socket.exe'])
      expect(manifest['libc']).toBeUndefined()
    })
  })
})
