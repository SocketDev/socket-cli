// Exercises the socket wrapper's bootstrap loader — the name/platform
// resolution behind the cli.exe → legacy @socketbin fallback chain.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

import { afterAll, describe, expect, it } from 'vitest'

// The loader is a CJS bin script — load it through createRequire.
const require = createRequire(import.meta.url)
const {
  binaryNameFor,
  candidateBinaryPaths,
  candidatePackageNames,
  findBinaryPath,
  resolveTriplet,
} = require('../../../../package-builder/templates/socket-package/bin/socket.js')

describe('socket bootstrap loader', () => {
  describe('resolveTriplet', () => {
    it('maps supported platform + arch combinations', () => {
      expect(resolveTriplet('darwin', 'arm64', false)).toBe('darwin-arm64')
      expect(resolveTriplet('darwin', 'x64', false)).toBe('darwin-x64')
      expect(resolveTriplet('linux', 'arm64', false)).toBe('linux-arm64')
      expect(resolveTriplet('win32', 'x64', false)).toBe('win32-x64')
    })

    it('applies musl on linux only', () => {
      expect(resolveTriplet('linux', 'x64', true)).toBe('linux-x64-musl')
      expect(resolveTriplet('linux', 'arm64', true)).toBe('linux-arm64-musl')
      expect(resolveTriplet('darwin', 'arm64', true)).toBe('darwin-arm64')
      expect(resolveTriplet('win32', 'x64', true)).toBe('win32-x64')
    })

    it('returns undefined off the support matrix', () => {
      expect(resolveTriplet('sunos', 'x64', false)).toBeUndefined()
      expect(resolveTriplet('linux', 'ia32', false)).toBeUndefined()
    })
  })

  describe('candidatePackageNames', () => {
    it('prefers the cli.exe tail and falls back to the frozen @socketbin name', () => {
      expect(candidatePackageNames('darwin-arm64')).toEqual([
        '@socketsecurity/cli.exe.darwin-arm64',
        '@socketbin/cli-darwin-arm64',
      ])
    })

    it('falls back to alpine names for musl, never the empty cli-linux-*-musl placeholders', () => {
      expect(candidatePackageNames('linux-x64-musl')).toEqual([
        '@socketsecurity/cli.exe.linux-x64-musl',
        '@socketbin/cli-alpine-x64',
      ])
    })

    it('falls back to win32 names, never the empty cli-win-* placeholders', () => {
      expect(candidatePackageNames('win32-arm64')).toEqual([
        '@socketsecurity/cli.exe.win32-arm64',
        '@socketbin/cli-win32-arm64',
      ])
    })
  })

  describe('binaryNameFor', () => {
    it('suffixes .exe on windows only', () => {
      expect(binaryNameFor('win32-x64')).toBe('socket.exe')
      expect(binaryNameFor('linux-x64-musl')).toBe('socket')
      expect(binaryNameFor('darwin-arm64')).toBe('socket')
    })
  })

  describe('candidateBinaryPaths', () => {
    it('probes dependency, hoisted, and workspace layouts under bin/', () => {
      const paths = candidateBinaryPaths(
        '@socketsecurity/cli.exe.linux-x64',
        'socket',
        path.join('root', 'pkg', 'bin'),
      )
      expect(paths).toHaveLength(3)
      for (const p of paths) {
        expect(
          p.endsWith(path.join('cli.exe.linux-x64', 'bin', 'socket')),
        ).toBe(true)
      }
    })
  })

  describe('findBinaryPath', () => {
    const tempDirs: string[] = []

    afterAll(async () => {
      for (let i = 0, { length } = tempDirs; i < length; i += 1) {
        // eslint-disable-next-line no-await-in-loop -- sequential teardown of a handful of dirs.
        await safeDelete(tempDirs[i]!)
      }
    })

    function makeInstall(packageName: string, binaryName: string): string {
      const root = mkdtempSync(path.join(os.tmpdir(), 'socket-loader-'))
      tempDirs.push(root)
      // Layout: <root>/node_modules/socket/bin plus the tail package.
      const fromDir = path.join(root, 'node_modules', 'socket', 'bin')
      mkdirSync(fromDir, { recursive: true })
      const tailDir = path.join(root, 'node_modules', ...packageName.split('/'))
      mkdirSync(path.join(tailDir, 'bin'), { recursive: true })
      writeFileSync(
        path.join(tailDir, 'package.json'),
        JSON.stringify({ name: packageName, version: '0.0.0' }),
      )
      writeFileSync(path.join(tailDir, 'bin', binaryName), '#!/bin/sh\n')
      return fromDir
    }

    it('finds the cli.exe tail binary when installed', () => {
      const fromDir = makeInstall('@socketsecurity/cli.exe.linux-x64', 'socket')
      const found = findBinaryPath('linux-x64', fromDir)
      expect(found).toBeDefined()
      expect(found!.includes('cli.exe.linux-x64')).toBe(true)
    })

    it('falls back to the legacy @socketbin binary when only that is installed', () => {
      const fromDir = makeInstall('@socketbin/cli-alpine-x64', 'socket')
      const found = findBinaryPath('linux-x64-musl', fromDir)
      expect(found).toBeDefined()
      expect(found!.includes('cli-alpine-x64')).toBe(true)
    })

    it('returns undefined when no tail is installed', () => {
      const root = mkdtempSync(path.join(os.tmpdir(), 'socket-loader-'))
      tempDirs.push(root)
      const fromDir = path.join(root, 'node_modules', 'socket', 'bin')
      mkdirSync(fromDir, { recursive: true })
      expect(findBinaryPath('darwin-arm64', fromDir)).toBeUndefined()
    })
  })
})
