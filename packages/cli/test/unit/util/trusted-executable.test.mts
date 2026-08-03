/**
 * Unit tests for PATH-trust-inverting executable resolution.
 *
 * Test Coverage:
 *
 * - `resolveTrustedExecutable`: repository-local PATH entries excluded, poisoned
 *   entries stripped from the returned PATH, literal-path candidates, misses,
 *   case-insensitive PATH keys, exec-bit enforcement, Windows batch-shim
 *   poisoning.
 * - `defaultProtectedRoot`: walks up to the outermost `.git` marker.
 * - `listExecutableProbes`: per-platform suffix table.
 * - `isPathWithinRoot`: containment.
 *
 * Related Files: - src/util/trusted-executable.mts (implementation)
 *
 * Fixtures are real directories under the OS temp dir with real files and real
 * symlinks; mocking `fs` here would mock away the realpath canonicalization
 * that is the whole point of the module.
 */

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

import {
  defaultProtectedRoot,
  isPathWithinRoot,
  listExecutableProbes,
  resolveTrustedExecutable,
} from '../../../src/util/trusted-executable.mts'

// The exec bit only gates access() on POSIX; Windows reports every readable
// file as executable, so the exec-bit assertions run on POSIX alone.
const EXEC_BIT_IS_ENFORCED = process.platform !== 'win32'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), 'socket-trusted-exe-')),
  )
  tempDirs.push(dir)
  return dir
}

function writeExecutable(dir: string, name: string): string {
  const filePath = path.join(dir, name)
  writeFileSync(filePath, '#!/bin/sh\nexit 0\n')
  chmodSync(filePath, 0o755)
  return filePath
}

afterEach(async () => {
  const dirs = tempDirs.splice(0)
  for (let i = 0, { length } = dirs; i < length; i += 1) {
    await safeDelete(dirs[i]!)
  }
})

describe('trusted-executable', () => {
  describe('isPathWithinRoot', () => {
    it('treats the root itself as contained', () => {
      expect(isPathWithinRoot('/a/b', '/a/b')).toBe(true)
    })

    it('treats a descendant as contained', () => {
      expect(isPathWithinRoot('/a/b', path.join('/a/b', 'c', 'd'))).toBe(true)
    })

    it('treats a sibling with a shared prefix as outside', () => {
      expect(isPathWithinRoot('/a/b', '/a/bb')).toBe(false)
    })

    it('treats an ancestor as outside', () => {
      expect(isPathWithinRoot('/a/b', '/a')).toBe(false)
    })
  })

  describe('listExecutableProbes', () => {
    it('probes only the bare name off Windows', () => {
      expect(listExecutableProbes('git', { windows: false })).toEqual([
        { runnable: true, suffix: '' },
      ])
    })

    it('marks Windows batch and extensionless variants unrunnable', () => {
      expect(listExecutableProbes('git', { windows: true })).toEqual([
        { runnable: true, suffix: '.exe' },
        { runnable: true, suffix: '.com' },
        { runnable: false, suffix: '.bat' },
        { runnable: false, suffix: '.cmd' },
        { runnable: false, suffix: '' },
      ])
    })

    it('does not append a second suffix to an already-suffixed candidate', () => {
      expect(listExecutableProbes('python.EXE', { windows: true })).toEqual([
        { runnable: true, suffix: '' },
      ])
    })
  })

  describe('defaultProtectedRoot', () => {
    it('returns the outermost .git ancestor', async () => {
      const root = makeTempDir()
      const outer = path.join(root, 'outer')
      const inner = path.join(outer, 'packages', 'inner')
      const deep = path.join(inner, 'src')
      mkdirSync(deep, { recursive: true })
      mkdirSync(path.join(outer, '.git'))
      // A worktree or submodule marks its root with a `.git` FILE.
      writeFileSync(path.join(inner, '.git'), 'gitdir: ../elsewhere\n')

      expect(await defaultProtectedRoot(deep)).toBe(outer)
    })

    it('falls back to the realpath of cwd when no .git marker exists', async () => {
      const root = makeTempDir()
      const nested = path.join(root, 'nested')
      mkdirSync(nested)

      expect(await defaultProtectedRoot(nested)).toBe(nested)
    })
  })

  describe('resolveTrustedExecutable', () => {
    it('ignores a PATH entry inside the protected root', async () => {
      const root = makeTempDir()
      const repo = path.join(root, 'repo')
      const repoBin = path.join(repo, 'node_modules', '.bin')
      const systemBin = path.join(root, 'usr-bin')
      mkdirSync(repoBin, { recursive: true })
      mkdirSync(systemBin)
      writeExecutable(repoBin, 'git')
      const systemGit = writeExecutable(systemBin, 'git')

      const result = await resolveTrustedExecutable(
        'git',
        {
          HOME: '/home/nobody',
          PATH: [repoBin, systemBin].join(path.delimiter),
        },
        repo,
        { windows: false },
      )

      expect(result).toEqual({
        environment: { HOME: '/home/nobody', PATH: systemBin },
        executable: systemGit,
      })
    })

    it('ignores a PATH entry that symlinks into the protected root', async () => {
      const root = makeTempDir()
      const repo = path.join(root, 'repo')
      const repoBin = path.join(repo, 'bin')
      const systemBin = path.join(root, 'usr-bin')
      mkdirSync(repoBin, { recursive: true })
      mkdirSync(systemBin)
      writeExecutable(repoBin, 'git')
      const systemGit = writeExecutable(systemBin, 'git')
      const linkedBin = path.join(root, 'linked-bin')
      symlinkSync(repoBin, linkedBin, 'dir')

      const result = await resolveTrustedExecutable(
        'git',
        { PATH: [linkedBin, systemBin].join(path.delimiter) },
        repo,
        { windows: false },
      )

      expect(result).toEqual({
        environment: { PATH: systemBin },
        executable: systemGit,
      })
    })

    it('strips a PATH entry whose candidate symlinks into the protected root', async () => {
      const root = makeTempDir()
      const repo = path.join(root, 'repo')
      const systemBin = path.join(root, 'usr-bin')
      const shimBin = path.join(root, 'shim-bin')
      mkdirSync(repo)
      mkdirSync(systemBin)
      mkdirSync(shimBin)
      const repoGit = writeExecutable(repo, 'git')
      symlinkSync(repoGit, path.join(shimBin, 'git'), 'file')
      const systemGit = writeExecutable(systemBin, 'git')

      const result = await resolveTrustedExecutable(
        'git',
        { PATH: [shimBin, systemBin].join(path.delimiter) },
        repo,
        { windows: false },
      )

      // The shim directory resolves outside the root, so it survives entry
      // filtering — it is the CANDIDATE hit inside the root that poisons it.
      expect(result).toEqual({
        environment: { PATH: systemBin },
        executable: systemGit,
      })
    })

    it('poisons a PATH entry from an unrunnable Windows batch shim', async () => {
      const root = makeTempDir()
      const repo = path.join(root, 'repo')
      const systemBin = path.join(root, 'usr-bin')
      const shimBin = path.join(root, 'shim-bin')
      mkdirSync(repo)
      mkdirSync(systemBin)
      mkdirSync(shimBin)
      const repoBatch = path.join(repo, 'git.cmd')
      writeFileSync(repoBatch, '@echo off\r\n')
      symlinkSync(repoBatch, path.join(shimBin, 'git.cmd'), 'file')
      writeFileSync(path.join(shimBin, 'git.exe'), 'not a repository binary')
      const systemGit = path.join(systemBin, 'git.exe')
      writeFileSync(systemGit, 'system binary')

      const result = await resolveTrustedExecutable(
        'git',
        { PATH: [shimBin, systemBin].join(path.delimiter) },
        repo,
        { windows: true },
      )

      // `git.cmd` can never be launched, but its presence proves the shim
      // directory is attacker-reachable. The entry leaves the PATH, and its
      // own `git.exe` loses to the system copy even though it was probed
      // first — a condemned directory cannot supply the winner either.
      expect(result).toEqual({
        environment: { PATH: systemBin },
        executable: systemGit,
      })
    })

    it('accepts a literal path candidate without consulting PATH', async () => {
      const root = makeTempDir()
      const repo = path.join(root, 'repo')
      const toolsDir = path.join(root, 'tools')
      mkdirSync(repo)
      mkdirSync(toolsDir)
      const tool = writeExecutable(toolsDir, 'scanner')

      const result = await resolveTrustedExecutable(
        path.join(toolsDir, 'scanner'),
        { PATH: '' },
        repo,
        { windows: false },
      )

      expect(result).toEqual({ environment: { PATH: '' }, executable: tool })
    })

    it('rejects a literal path candidate inside the protected root', async () => {
      const root = makeTempDir()
      const repo = path.join(root, 'repo')
      mkdirSync(repo)
      writeExecutable(repo, 'git')

      expect(
        await resolveTrustedExecutable(
          path.join(repo, 'git'),
          { PATH: '' },
          repo,
          { windows: false },
        ),
      ).toBeUndefined()
    })

    it('returns undefined when the candidate is not on PATH', async () => {
      const root = makeTempDir()
      const repo = path.join(root, 'repo')
      const systemBin = path.join(root, 'usr-bin')
      mkdirSync(repo)
      mkdirSync(systemBin)
      writeExecutable(systemBin, 'git')

      expect(
        await resolveTrustedExecutable('hg', { PATH: systemBin }, repo, {
          windows: false,
        }),
      ).toBeUndefined()
    })

    it('finds PATH under a Windows-cased key and rewrites it as PATH', async () => {
      const root = makeTempDir()
      const repo = path.join(root, 'repo')
      const systemBin = path.join(root, 'usr-bin')
      mkdirSync(repo)
      mkdirSync(systemBin)
      const systemGit = writeExecutable(systemBin, 'git')

      const result = await resolveTrustedExecutable(
        'git',
        { KEEP: 'ok', Path: systemBin },
        repo,
        { windows: false },
      )

      expect(result).toEqual({
        environment: { KEEP: 'ok', PATH: systemBin },
        executable: systemGit,
      })
      expect(Object.keys(result!.environment)).not.toContain('Path')
    })

    it('drops empty, relative, and unresolvable PATH entries', async () => {
      const root = makeTempDir()
      const repo = path.join(root, 'repo')
      const systemBin = path.join(root, 'usr-bin')
      mkdirSync(repo)
      mkdirSync(systemBin)
      const systemGit = writeExecutable(systemBin, 'git')

      const result = await resolveTrustedExecutable(
        'git',
        {
          PATH: [
            '',
            'relative/bin',
            path.join(root, 'missing-bin'),
            systemBin,
            systemBin,
          ].join(path.delimiter),
        },
        repo,
        { windows: false },
      )

      expect(result).toEqual({
        environment: { PATH: systemBin },
        executable: systemGit,
      })
    })

    it('returns undefined when no PATH variable is present', async () => {
      const root = makeTempDir()
      const repo = path.join(root, 'repo')
      mkdirSync(repo)

      expect(
        await resolveTrustedExecutable('git', { HOME: root }, repo, {
          windows: false,
        }),
      ).toBeUndefined()
    })

    it('skips a directory that shares the candidate name', async () => {
      const root = makeTempDir()
      const repo = path.join(root, 'repo')
      const decoyBin = path.join(root, 'decoy-bin')
      const systemBin = path.join(root, 'usr-bin')
      mkdirSync(repo)
      mkdirSync(path.join(decoyBin, 'git'), { recursive: true })
      mkdirSync(systemBin)
      const systemGit = writeExecutable(systemBin, 'git')

      const result = await resolveTrustedExecutable(
        'git',
        { PATH: [decoyBin, systemBin].join(path.delimiter) },
        repo,
        { windows: false },
      )

      expect(result).toEqual({
        environment: { PATH: [decoyBin, systemBin].join(path.delimiter) },
        executable: systemGit,
      })
    })

    it.skipIf(!EXEC_BIT_IS_ENFORCED)(
      'skips a non-executable file and keeps searching',
      async () => {
        const root = makeTempDir()
        const repo = path.join(root, 'repo')
        const readOnlyBin = path.join(root, 'read-only-bin')
        const systemBin = path.join(root, 'usr-bin')
        mkdirSync(repo)
        mkdirSync(readOnlyBin)
        mkdirSync(systemBin)
        const notExecutable = path.join(readOnlyBin, 'git')
        writeFileSync(notExecutable, 'plain text')
        chmodSync(notExecutable, 0o644)
        const systemGit = writeExecutable(systemBin, 'git')

        const result = await resolveTrustedExecutable(
          'git',
          { PATH: [readOnlyBin, systemBin].join(path.delimiter) },
          repo,
          { windows: false },
        )

        expect(result).toEqual({
          environment: {
            PATH: [readOnlyBin, systemBin].join(path.delimiter),
          },
          executable: systemGit,
        })
      },
    )
  })
})
