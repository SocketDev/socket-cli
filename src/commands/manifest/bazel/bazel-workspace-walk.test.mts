import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@socketsecurity/registry/lib/logger'

import { findWorkspaceRoots } from './bazel-workspace-walk.mts'

function touch(file: string): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, '')
}

// Standard prune set Bazel callers pass: the codebase-wide IGNORED_DIRS
// (.git, node_modules, etc.) plus the walker's own output dir, plus
// `bazel-*` output_base symlinks and `dist*` build outputs. Replicated
// inline here so the test stays decoupled from `src/utils/glob.mts`.
const BAZEL_IGNORE_NAMES: ReadonlySet<string> = new Set([
  '.git',
  '.hg',
  '.idea',
  '.pnpm-store',
  '.socket-auto-manifest',
  '.svn',
  '.vscode',
  'node_modules',
])
const BAZEL_IGNORE_PREFIXES: readonly string[] = ['bazel-', 'dist']

describe('bazel-workspace-walk', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'sock-bazel-walk-'))
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  describe('findWorkspaceRoots', () => {
    it('returns the root when only the root has MODULE.bazel', () => {
      touch(path.join(tmp, 'MODULE.bazel'))
      expect(findWorkspaceRoots({ cwd: tmp })).toEqual([tmp])
    })

    it('detects WORKSPACE and WORKSPACE.bazel as root markers', () => {
      touch(path.join(tmp, 'WORKSPACE'))
      expect(findWorkspaceRoots({ cwd: tmp })).toEqual([tmp])
      rmSync(path.join(tmp, 'WORKSPACE'))
      touch(path.join(tmp, 'WORKSPACE.bazel'))
      expect(findWorkspaceRoots({ cwd: tmp })).toEqual([tmp])
    })

    it('finds nested workspaces at arbitrary depth', () => {
      touch(path.join(tmp, 'MODULE.bazel'))
      touch(path.join(tmp, 'examples', 'dagger', 'MODULE.bazel'))
      touch(path.join(tmp, 'examples', 'android', 'nested', 'WORKSPACE.bazel'))
      const found = findWorkspaceRoots({ cwd: tmp }).map(p =>
        path.relative(tmp, p),
      )
      expect(found).toEqual(['', 'examples/android/nested', 'examples/dagger'])
    })

    it('returns [] when there is no workspace root', () => {
      writeFileSync(path.join(tmp, 'README.md'), '')
      expect(findWorkspaceRoots({ cwd: tmp })).toEqual([])
    })

    it('does NOT prune by default — pruning policy is caller-supplied', () => {
      touch(path.join(tmp, 'MODULE.bazel'))
      touch(path.join(tmp, 'node_modules', 'MODULE.bazel'))
      const found = findWorkspaceRoots({ cwd: tmp }).map(p =>
        path.relative(tmp, p),
      )
      expect(found).toEqual(['', 'node_modules'])
    })

    it('prunes injected ignoreDirNames', () => {
      touch(path.join(tmp, 'MODULE.bazel'))
      for (const dir of ['node_modules', '.git', '.socket-auto-manifest']) {
        touch(path.join(tmp, dir, 'sub', 'MODULE.bazel'))
      }
      const found = findWorkspaceRoots({
        cwd: tmp,
        ignoreDirNames: BAZEL_IGNORE_NAMES,
      }).map(p => path.relative(tmp, p))
      expect(found).toEqual([''])
    })

    it('prunes injected ignoreDirPrefixes (bazel-* symlinks)', () => {
      const fakeOutputBase = mkdtempSync(
        path.join(os.tmpdir(), 'sock-fake-outbase-'),
      )
      try {
        mkdirSync(path.join(fakeOutputBase, 'external', 'maven'), {
          recursive: true,
        })
        touch(path.join(fakeOutputBase, 'external', 'maven', 'MODULE.bazel'))
        symlinkSync(fakeOutputBase, path.join(tmp, 'bazel-out'))
        touch(path.join(tmp, 'MODULE.bazel'))
        const found = findWorkspaceRoots({
          cwd: tmp,
          ignoreDirPrefixes: BAZEL_IGNORE_PREFIXES,
        }).map(p => path.relative(tmp, p))
        expect(found).toEqual([''])
      } finally {
        rmSync(fakeOutputBase, { recursive: true, force: true })
      }
    })

    it('prunes injected dist* prefix', () => {
      touch(path.join(tmp, 'MODULE.bazel'))
      touch(path.join(tmp, 'dist', 'MODULE.bazel'))
      touch(path.join(tmp, 'distribution', 'MODULE.bazel'))
      const found = findWorkspaceRoots({
        cwd: tmp,
        ignoreDirPrefixes: BAZEL_IGNORE_PREFIXES,
      }).map(p => path.relative(tmp, p))
      expect(found).toEqual([''])
    })

    it('returns absolute, sorted paths', () => {
      touch(path.join(tmp, 'z', 'MODULE.bazel'))
      touch(path.join(tmp, 'a', 'MODULE.bazel'))
      touch(path.join(tmp, 'm', 'MODULE.bazel'))
      const found = findWorkspaceRoots({ cwd: tmp })
      expect(found).toEqual([
        path.join(tmp, 'a'),
        path.join(tmp, 'm'),
        path.join(tmp, 'z'),
      ])
      for (const p of found) {
        expect(path.isAbsolute(p)).toBe(true)
      }
    })

    it('handles an unreadable directory by skipping it (no throw)', () => {
      touch(path.join(tmp, 'MODULE.bazel'))
      expect(findWorkspaceRoots({ cwd: path.join(tmp, 'nope') })).toEqual([])
    })

    it('finds a workspace marker deeper than the old depth-8 cap (depth 9)', () => {
      const deep = path.join(
        tmp,
        'l1',
        'l2',
        'l3',
        'l4',
        'l5',
        'l6',
        'l7',
        'l8',
        'l9',
      )
      touch(path.join(deep, 'MODULE.bazel'))
      const found = findWorkspaceRoots({ cwd: tmp })
      expect(found).toEqual([deep])
    })
  })

  describe('findWorkspaceRoots truncation', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger)
    })

    afterEach(() => {
      warnSpy.mockRestore()
    })

    it('caps at 16 roots, warns unconditionally, and keeps the sorted survivors', () => {
      // 18 sibling roots; only the 16 lexicographically smallest survive.
      const names = Array.from(
        { length: 18 },
        (_, i) => `r${String(i).padStart(2, '0')}`,
      )
      for (const name of names) {
        touch(path.join(tmp, name, 'MODULE.bazel'))
      }
      const found = findWorkspaceRoots({ cwd: tmp }).map(p =>
        path.relative(tmp, p),
      )
      expect(found).toHaveLength(16)
      expect(found).toEqual(names.slice(0, 16))
      expect(warnSpy).toHaveBeenCalled()
      expect(warnSpy.mock.calls.map(c => String(c[0])).join('\n')).toMatch(
        /capping at 16 and dropping 2/,
      )
    })

    it('warns unconditionally when the visited-directory budget is exhausted', () => {
      for (const name of ['a', 'b', 'c']) {
        touch(path.join(tmp, name, 'MODULE.bazel'))
      }
      // Budget of 3 visits tmp + a + b, then stops before c.
      const found = findWorkspaceRoots({ cwd: tmp, maxWalkDirs: 3 }).map(p =>
        path.relative(tmp, p),
      )
      expect(found).toEqual(['a', 'b'])
      expect(warnSpy.mock.calls.map(c => String(c[0])).join('\n')).toMatch(
        /directory budget/,
      )
    })

    it('does not warn on a normal small tree', () => {
      touch(path.join(tmp, 'MODULE.bazel'))
      touch(path.join(tmp, 'examples', 'dagger', 'MODULE.bazel'))
      findWorkspaceRoots({ cwd: tmp })
      expect(warnSpy).not.toHaveBeenCalled()
    })
  })
})
