import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { findWorkspaceRoots } from './bazel-workspace-walk.mts'

function touch(file: string): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, '')
}

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
      expect(findWorkspaceRoots(tmp)).toEqual([tmp])
    })

    it('detects WORKSPACE and WORKSPACE.bazel as root markers', () => {
      touch(path.join(tmp, 'WORKSPACE'))
      expect(findWorkspaceRoots(tmp)).toEqual([tmp])
      rmSync(path.join(tmp, 'WORKSPACE'))
      touch(path.join(tmp, 'WORKSPACE.bazel'))
      expect(findWorkspaceRoots(tmp)).toEqual([tmp])
    })

    it('finds nested workspaces at arbitrary depth', () => {
      touch(path.join(tmp, 'MODULE.bazel'))
      touch(path.join(tmp, 'examples', 'dagger', 'MODULE.bazel'))
      touch(path.join(tmp, 'examples', 'android', 'nested', 'WORKSPACE.bazel'))
      const found = findWorkspaceRoots(tmp).map(p => path.relative(tmp, p))
      expect(found).toEqual([
        '',
        'examples/android/nested',
        'examples/dagger',
      ])
    })

    it('returns [] when there is no workspace root', () => {
      writeFileSync(path.join(tmp, 'README.md'), '')
      expect(findWorkspaceRoots(tmp)).toEqual([])
    })

    it('prunes .git / node_modules / .socket-auto-manifest', () => {
      touch(path.join(tmp, 'MODULE.bazel'))
      // Sub-MODULE.bazel files inside pruned dirs must not be surfaced.
      for (const dir of ['node_modules', '.git', '.socket-auto-manifest']) {
        touch(path.join(tmp, dir, 'sub', 'MODULE.bazel'))
      }
      const found = findWorkspaceRoots(tmp).map(p => path.relative(tmp, p))
      expect(found).toEqual([''])
    })

    it('prunes bazel-* convenience symlinks', () => {
      // Simulate `bazel-out` pointing at a directory that contains a copy of
      // MODULE.bazel. The walk must skip it; otherwise discovery would
      // surface generated workspaces from <output_base>.
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
        const found = findWorkspaceRoots(tmp).map(p => path.relative(tmp, p))
        expect(found).toEqual([''])
      } finally {
        rmSync(fakeOutputBase, { recursive: true, force: true })
      }
    })

    it('prunes dist* build-output directories', () => {
      touch(path.join(tmp, 'MODULE.bazel'))
      touch(path.join(tmp, 'dist', 'MODULE.bazel'))
      touch(path.join(tmp, 'distribution', 'MODULE.bazel'))
      const found = findWorkspaceRoots(tmp).map(p => path.relative(tmp, p))
      expect(found).toEqual([''])
    })

    it('returns absolute, sorted paths', () => {
      touch(path.join(tmp, 'z', 'MODULE.bazel'))
      touch(path.join(tmp, 'a', 'MODULE.bazel'))
      touch(path.join(tmp, 'm', 'MODULE.bazel'))
      const found = findWorkspaceRoots(tmp)
      expect(found).toEqual([
        path.join(tmp, 'a'),
        path.join(tmp, 'm'),
        path.join(tmp, 'z'),
      ])
      // Absolute.
      for (const p of found) {
        expect(path.isAbsolute(p)).toBe(true)
      }
    })

    it('handles an unreadable directory by skipping it (no throw)', () => {
      touch(path.join(tmp, 'MODULE.bazel'))
      // Reference a path that does not exist as cwd; the walker must not
      // throw — it should return [] (no entries to read).
      expect(findWorkspaceRoots(path.join(tmp, 'nope'))).toEqual([])
    })
  })
})
