/**
 * Unit tests for `globWithGitIgnore` against a real filesystem.
 *
 * Purpose: exercises the discovery walk's directory pruning — Python virtual
 * environments and directories the running user cannot read — where the
 * behavior under test is filesystem state, not pattern math.
 *
 * Related Files: - util/fs/glob.mts (implementation) - glob.test.mts (the
 * pattern-level unit tests, which mock the filesystem).
 */

import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { globWithGitIgnore } from '../../../../src/util/fs/glob.mts'

describe('globWithGitIgnore', () => {
  // Reproduces the reported `socket fix` crash: a project holding a directory
  // the running user cannot enter (a postgres `pgdata` dir owned by another
  // uid, mode drwx------) made fast-glob throw `EACCES: permission denied,
  // scandir` during manifest discovery. Uses the real filesystem because
  // permission bits are what is under test; skipped under root (perm checks
  // are bypassed) and on Windows (no POSIX directory perms).
  const skipUnreadableDirTest =
    process.platform === 'win32' ||
    (typeof process.getuid === 'function' && process.getuid() === 0)

  async function globInTempTree(
    files: Record<string, string>,
    patterns: string[],
  ): Promise<string[]> {
    const realTmp = mkdtempSync(path.join(os.tmpdir(), 'socket-glob-tree-'))
    try {
      const relPaths = Object.keys(files)
      for (let i = 0, { length } = relPaths; i < length; i += 1) {
        const relPath = relPaths[i]!
        const absPath = path.join(realTmp, relPath)
        mkdirSync(path.dirname(absPath), { recursive: true })
        writeFileSync(absPath, files[relPath]!)
      }
      const results = await globWithGitIgnore(patterns, { cwd: realTmp })
      return results
        .map(p => normalizePath(path.relative(realTmp, p)))
        .toSorted()
    } finally {
      safeDeleteSync(realTmp)
    }
  }

  it('excludes a Python virtual environment detected via pyvenv.cfg', async () => {
    // A venv can use any directory name; the reliable signal is the
    // pyvenv.cfg marker at its root. Manifests inside it must not surface.
    const results = await globInTempTree(
      {
        'requirements.txt': '',
        'myenv/pyvenv.cfg': 'home = /usr/bin\nversion = 3.11.0\n',
        'myenv/requirements.txt': '',
        'myenv/lib/python3.11/site-packages/foo/setup.py': '',
      },
      ['**/requirements.txt', '**/setup.py'],
    )
    expect(results).toEqual(['requirements.txt'])
  })

  it('excludes a `.venv` directory by name', async () => {
    const results = await globInTempTree(
      {
        'package.json': '{}',
        '.venv/lib/site-packages/foo/package.json': '{}',
      },
      ['**/*.json'],
    )
    expect(results).toEqual(['package.json'])
  })

  it('keeps a non-venv directory named `venv` without a pyvenv.cfg', async () => {
    // Guards against over-exclusion: a bare `venv` dir is only skipped when
    // it actually holds a pyvenv.cfg, never by name alone.
    const results = await globInTempTree(
      {
        'package.json': '{}',
        'venv/package.json': '{}',
      },
      ['**/*.json'],
    )
    expect(results).toEqual(['package.json', 'venv/package.json'])
  })

  it.skipIf(skipUnreadableDirTest)(
    'skips an unreadable directory instead of throwing EACCES',
    async () => {
      const realTmp = mkdtempSync(path.join(os.tmpdir(), 'socket-glob-perm-'))
      const unreadable = path.join(realTmp, 'data/postgres/pgdata')
      try {
        mkdirSync(unreadable, { recursive: true })
        writeFileSync(path.join(realTmp, 'package.json'), '{}')
        // Files inside the directory must never surface — the user cannot
        // read them, so they cannot be scanned.
        writeFileSync(path.join(unreadable, 'PG_VERSION'), '17')
        chmodSync(unreadable, 0o000)

        const results = await globWithGitIgnore(['**/*'], { cwd: realTmp })

        expect(results.map(normalizePath)).toEqual([
          normalizePath(path.join(realTmp, 'package.json')),
        ])
      } finally {
        // Restore perms so recursive cleanup can descend into the locked dir.
        try {
          chmodSync(unreadable, 0o755)
        } catch {}
        safeDeleteSync(realTmp)
      }
    },
  )
})
