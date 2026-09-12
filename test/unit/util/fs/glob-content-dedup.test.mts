/**
 * Unit tests for `globWithGitIgnore`'s slow-path gitignore matching.
 *
 * Purpose: the slow path (any `!` negation present) used to flatten every
 * nested .gitignore into one cwd-anchored `ignore` instance. Its first match
 * call JIT-compiled every pattern into V8 code space — capped near 250-300MB
 * regardless of --max-old-space-size — so a large monorepo aborted with a heap
 * OOM before the scan ran. These cover nested-gitignore semantics.
 * The integration suite covers the large-monorepo memory bound.
 *
 * Related Files: - util/fs/glob.mts (implementation) -
 * glob-with-gitignore.test.mts (the discovery-walk filesystem tests).
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { globWithGitIgnore } from '../../../../src/util/fs/glob.mts'

function jsonFilter(filepath: string): boolean {
  return filepath.endsWith('.json')
}

// The fix is scoped to the slow path (a `!` negation present anywhere), where
// the previous code routed everything through one global matcher that OOM'd.
// That path now applies each .gitignore relative to its own directory, which is
// also more git-faithful than the earlier cwd-anchored translation. The
// no-negation fast path is unchanged, so these cases each include a negation to
// exercise the reworked slow path. Both verified against `git check-ignore`.
describe('globWithGitIgnore() nested-gitignore semantics (slow path)', () => {
  // A bare filename (no slash) in a nested .gitignore matches at any depth below
  // that directory, the way git applies it.
  it('honors a bare filename at any depth below its .gitignore', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'socket-glob-bare-'))
    try {
      mkdirSync(path.join(root, 'packages/example/sub'), { recursive: true })
      writeFileSync(path.join(root, 'package.json'), '{}')
      // The `!` line forces the slow path; it matches none of the manifests.
      writeFileSync(
        path.join(root, 'packages/example/.gitignore'),
        'secret.json\n!unused.keep\n',
      )
      writeFileSync(path.join(root, 'packages/example/package.json'), '{}')
      writeFileSync(path.join(root, 'packages/example/sub/secret.json'), '{}')
      writeFileSync(path.join(root, 'packages/example/sub/keep.json'), '{}')

      const results = await globWithGitIgnore(['**/*'], {
        cwd: root,
        filter: jsonFilter,
      })
      const rel = results
        .map(p => normalizePath(path.relative(root, p)))
        .toSorted()
      expect(rel).toEqual([
        'package.json',
        'packages/example/package.json',
        'packages/example/sub/keep.json',
      ])
      expect(rel).not.toContain('packages/example/sub/secret.json')
    } finally {
      safeDeleteSync(root)
    }
  })

  // A file cannot be re-included if a parent directory is excluded: a root
  // `build/` keeps everything under build/ ignored even when a deeper .gitignore
  // negates a specific file.
  it('does not re-include a file under a parent-excluded directory', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'socket-glob-reinc-'))
    try {
      mkdirSync(path.join(root, 'packages/example/build'), { recursive: true })
      writeFileSync(path.join(root, 'package.json'), '{}')
      writeFileSync(path.join(root, '.gitignore'), 'build/\n')
      writeFileSync(
        path.join(root, 'packages/example/.gitignore'),
        '!build/important.json\n',
      )
      writeFileSync(
        path.join(root, 'packages/example/build/important.json'),
        '{}',
      )

      const results = await globWithGitIgnore(['**/*'], {
        cwd: root,
        filter: jsonFilter,
      })
      const rel = results
        .map(p => normalizePath(path.relative(root, p)))
        .toSorted()
      expect(rel).toEqual(['package.json'])
    } finally {
      safeDeleteSync(root)
    }
  })

  // Built-in directory excludes must still apply on the slow path, where the
  // matcher chain covers only gitignore/projectIgnore patterns: a pyvenv.cfg
  // virtualenv with a non-conventional name (caught via venvGlobs) and a static
  // IGNORED_DIRS entry like `coverage` that is absent from defaultIgnore.
  it('excludes built-in ignored dirs (venv, coverage) on the slow path', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'socket-glob-venv-'))
    try {
      mkdirSync(path.join(root, 'env'), { recursive: true })
      mkdirSync(path.join(root, 'coverage'), { recursive: true })
      writeFileSync(path.join(root, 'package.json'), '{}')
      // The `!` line forces the slow path; it matches none of the manifests.
      writeFileSync(path.join(root, '.gitignore'), '*.tmp\n!keep.tmp\n')
      writeFileSync(path.join(root, 'env/pyvenv.cfg'), 'home = /usr\n')
      writeFileSync(path.join(root, 'env/package.json'), '{}')
      writeFileSync(path.join(root, 'coverage/package.json'), '{}')

      const results = await globWithGitIgnore(['**/*'], {
        cwd: root,
        filter: jsonFilter,
      })
      const rel = results
        .map(p => normalizePath(path.relative(root, p)))
        .toSorted()
      expect(rel).toEqual(['package.json'])
    } finally {
      safeDeleteSync(root)
    }
  })
})
