/**
 * Unit tests for bootstrap's trusted PATH resolution.
 *
 * Bootstrap spawns npm and tar while the working directory is an untrusted
 * checkout, so it resolves them itself. Tests cover which PATH entries survive
 * the trust filter, the Windows suffix probe, and the shell requirement for a
 * Windows script.
 *
 * Related Files: - src/bootstrap/shared/system-bin-paths.mts.
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  getTrustedBinSearchPaths,
  needsShellForBinPath,
  resolveSystemBinPath,
  toComparableBinPath,
} from '../../../../src/bootstrap/shared/system-bin-paths.mts'

describe('bootstrap/shared/system-bin-paths', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'socket-bootstrap-bin-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { force: true, recursive: true })
  })

  describe('getTrustedBinSearchPaths', () => {
    it('keeps absolute system directories', () => {
      const result = getTrustedBinSearchPaths({
        cwd: '/repo',
        pathValue: '/usr/local/bin:/usr/bin',
        windows: false,
      })

      expect(result).toEqual(['/usr/local/bin', '/usr/bin'])
    })

    it('drops the working directory and its descendants', () => {
      const result = getTrustedBinSearchPaths({
        cwd: '/repo',
        pathValue: '/repo:/repo/bin:/usr/bin',
        windows: false,
      })

      expect(result).toEqual(['/usr/bin'])
    })

    it('drops node_modules/.bin shadow directories', () => {
      const result = getTrustedBinSearchPaths({
        cwd: '/repo',
        pathValue: '/elsewhere/node_modules/.bin:/usr/bin',
        windows: false,
      })

      expect(result).toEqual(['/usr/bin'])
    })

    it('drops relative and empty entries', () => {
      const result = getTrustedBinSearchPaths({
        cwd: '/repo',
        pathValue: '::.:./bin:/usr/bin',
        windows: false,
      })

      expect(result).toEqual(['/usr/bin'])
    })

    it('splits on semicolons and folds case on Windows', () => {
      const result = getTrustedBinSearchPaths({
        cwd: '/Repo',
        pathValue: '/REPO/bin;/Tools',
        windows: true,
      })

      expect(result).toEqual(['/Tools'])
    })
  })

  describe('resolveSystemBinPath', () => {
    it('returns the absolute path of a binary in a trusted directory', async () => {
      const binDir = path.join(tmpDir, 'bin')
      await fs.mkdir(binDir, { recursive: true })
      await fs.writeFile(path.join(binDir, 'npm'), '#!/bin/sh\n')

      const result = resolveSystemBinPath('npm', {
        cwd: '/repo',
        pathValue: binDir,
        windows: false,
      })

      expect(result).toBe(path.join(binDir, 'npm'))
    })

    it('skips a binary served by the working directory', async () => {
      const repoDir = path.join(tmpDir, 'repo')
      await fs.mkdir(repoDir, { recursive: true })
      await fs.writeFile(path.join(repoDir, 'npm'), '#!/bin/sh\n')

      const result = resolveSystemBinPath('npm', {
        cwd: repoDir,
        pathValue: repoDir,
        windows: false,
      })

      expect(result).toBeUndefined()
    })

    it('probes PATHEXT suffixes on Windows', async () => {
      const binDir = path.join(tmpDir, 'bin')
      await fs.mkdir(binDir, { recursive: true })
      await fs.writeFile(path.join(binDir, 'npm.cmd'), '@echo off\n')

      const result = resolveSystemBinPath('npm', {
        cwd: '/repo',
        pathExt: '.exe;.cmd',
        pathValue: binDir,
        windows: true,
      })

      expect(result).toBe(path.join(binDir, 'npm.cmd'))
    })

    it('returns undefined when nothing trusted holds the binary', () => {
      const result = resolveSystemBinPath('definitely-not-a-real-tool', {
        cwd: '/repo',
        pathValue: tmpDir,
        windows: false,
      })

      expect(result).toBeUndefined()
    })
  })

  describe('needsShellForBinPath', () => {
    it('requires a shell for Windows scripts', () => {
      expect(needsShellForBinPath('C:\\tools\\npm.CMD')).toBe(true)
      expect(needsShellForBinPath('C:\\tools\\npm.bat')).toBe(true)
      expect(needsShellForBinPath('C:\\tools\\npm.ps1')).toBe(true)
    })

    it('does not require a shell for executables', () => {
      expect(needsShellForBinPath('/usr/bin/tar')).toBe(false)
      expect(needsShellForBinPath('C:\\tools\\tar.exe')).toBe(false)
    })
  })

  describe('toComparableBinPath', () => {
    it('normalizes separators', () => {
      expect(toComparableBinPath('C:\\Tools\\bin', { windows: false })).toBe(
        'C:/Tools/bin',
      )
    })

    it('folds case on Windows', () => {
      expect(toComparableBinPath('C:\\Tools\\bin', { windows: true })).toBe(
        'c:/tools/bin',
      )
    })
  })
})
