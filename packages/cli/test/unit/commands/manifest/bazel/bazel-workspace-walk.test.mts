/**
 * Unit tests for the nested Bazel workspace walker (marker detection, injected
 * prune policy, root cap + budget warnings).
 */

import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the logger so cap/budget warnings are capturable without TTY noise.
const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  group: vi.fn(),
  groupEnd: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => mockLogger,
}))

import { findWorkspaceRoots } from '../../../../../src/commands/manifest/bazel/bazel-workspace-walk.mts'
import { safeDelete, safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'

function touch(file: string): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, '')
}

// A representative injected prune set for exercising the walker's generic
// name/prefix pruning. The walker hardcodes none of these; the production
// default (DEFAULT_BAZEL_WALKER_IGNORE_DIR_* in extract_bazel_to_maven.mts)
// is the codebase-wide ignore set + VCS/IDE dirs for names and just
// `['bazel-']` for prefixes. `dist` is included here only as an extra
// arbitrary prefix to prove multi-prefix pruning works, not because callers
// pass it.
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
    vi.clearAllMocks()
    tmp = mkdtempSync(path.join(os.tmpdir(), 'sock-bazel-walk-'))
  })

  afterEach(async () => {
    await safeDelete(tmp)
  })

  describe('findWorkspaceRoots', () => {
    it('returns the root when only the root has MODULE.bazel', () => {
      touch(path.join(tmp, 'MODULE.bazel'))
      expect(findWorkspaceRoots({ cwd: tmp })).toEqual([tmp])
    })

    it('detects WORKSPACE and WORKSPACE.bazel as root markers', () => {
      touch(path.join(tmp, 'WORKSPACE'))
      expect(findWorkspaceRoots({ cwd: tmp })).toEqual([tmp])
      safeDeleteSync(path.join(tmp, 'WORKSPACE'))
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
        safeDeleteSync(fakeOutputBase)
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

    it('finds a workspace marker at depth 9 (no depth cap)', () => {
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
    it('caps at 16 roots, warns unconditionally, and keeps the sorted survivors', () => {
      // 18 sibling roots; only the 16 lexicographically smallest survive.
      const names = Array.from(
        { length: 18 },
        (_, i) => `r${String(i).padStart(2, '0')}`,
      )
      for (let i = 0, { length } = names; i < length; i += 1) {
        const name = names[i]!
        touch(path.join(tmp, name, 'MODULE.bazel'))
      }
      const found = findWorkspaceRoots({ cwd: tmp }).map(p =>
        path.relative(tmp, p),
      )
      expect(found).toHaveLength(16)
      expect(found).toEqual(names.slice(0, 16))
      expect(mockLogger.warn).toHaveBeenCalled()
      expect(
        mockLogger.warn.mock.calls.map(c => String(c[0])).join('\n'),
      ).toMatch(/capping at 16 and dropping 2/)
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
      expect(
        mockLogger.warn.mock.calls.map(c => String(c[0])).join('\n'),
      ).toMatch(/directory budget/)
    })

    it('does not warn on a normal small tree', () => {
      touch(path.join(tmp, 'MODULE.bazel'))
      touch(path.join(tmp, 'examples', 'dagger', 'MODULE.bazel'))
      findWorkspaceRoots({ cwd: tmp })
      expect(mockLogger.warn).not.toHaveBeenCalled()
    })
  })
})
