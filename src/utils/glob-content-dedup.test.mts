import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import v8 from 'node:v8'

import { describe, expect, it } from 'vitest'

import { normalizePath } from '@socketsecurity/registry/lib/path'

import { globWithGitIgnore } from './glob.mts'

function codeSpaceMb(): number {
  const spaces = v8.getHeapSpaceStatistics()
  const used = (name: string) =>
    spaces.find(s => s.space_name === name)?.space_used_size ?? 0
  return (used('code_space') + used('code_large_object_space')) / 1_048_576
}

function jsonFilter(filepath: string): boolean {
  return filepath.endsWith('.json')
}

// Regression for the gitignore matcher OOM: flattening every nested .gitignore
// into one anchored `ignore` instance compiled one regex per (file x line) and
// exhausted V8 code-space (~250-300MB) mid-scan, aborting `socket fix`. Per-dir
// matchers cached by content compile each distinct .gitignore once, so a repo of
// N packages sharing one boilerplate .gitignore stays flat regardless of N.
describe('globWithGitIgnore() large-monorepo gitignore memory', () => {
  it('stays within code-space and honors gitignores on a huge repeated set', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'socket-glob-dedup-'))
    try {
      // 300 packages x 1000 lines = 300k nominal patterns. The pre-fix anchored
      // global matcher compiles all 300k and crosses the code-space cliff; the
      // content-deduped matcher compiles the single boilerplate body once.
      const pkgCount = 300
      const linesPerPkg = 1_000
      // A '!' negation: pre-fix this forced the slow `ignore`-package path that
      // OOM'd. The body is byte-identical across packages so they share one
      // compiled matcher.
      const lines: string[] = []
      for (let l = 0; l < linesPerPkg; l += 1) {
        lines.push(`generated_${l}/`)
      }
      lines.push('!keep.log')
      const gitignoreBody = `${lines.join('\n')}\n`

      writeFileSync(path.join(root, 'package.json'), '{}')
      const expected = [normalizePath(path.join(root, 'package.json'))]
      for (let d = 0; d < pkgCount; d += 1) {
        const pkgDir = path.join(root, 'packages', `pkg-${d}`)
        const ignoredDir = path.join(pkgDir, 'generated_0')
        mkdirSync(ignoredDir, { recursive: true })
        writeFileSync(path.join(pkgDir, '.gitignore'), gitignoreBody)
        writeFileSync(path.join(pkgDir, 'package.json'), '{}')
        // A manifest inside the package's own gitignored dir must be excluded,
        // proving the per-dir matcher still applies.
        writeFileSync(path.join(ignoredDir, 'package.json'), '{}')
        expected.push(normalizePath(path.join(pkgDir, 'package.json')))
      }

      const before = codeSpaceMb()
      // Mirror the production call: a manifest filter forces the streaming path.
      const results = await globWithGitIgnore(['**/*'], {
        cwd: root,
        filter: jsonFilter,
      })
      const after = codeSpaceMb()

      // Correctness: every package manifest found, every gitignored manifest skipped.
      expect(results.map(normalizePath).sort()).toEqual(expected.sort())
      // Memory: 300k nominal patterns collapse to one compiled matcher, so the
      // walk stays far below the ~250MB code-space cliff that aborted the scan.
      const grew = after - before
      // eslint-disable-next-line no-console
      console.log(
        `code_space: ${before.toFixed(1)} -> ${after.toFixed(1)} MB (grew ${grew.toFixed(1)})`,
      )
      expect(grew).toBeLessThan(80)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  }, 120_000)
})

// The fix is scoped to the slow path (a `!` negation present anywhere), where
// origin/v1.x routed everything through one global matcher that OOM'd. That path
// now applies each .gitignore relative to its own directory, which is also more
// git-faithful than origin's cwd-anchored translation. The no-negation fast path
// is left exactly as origin/v1.x, so these cases each include a negation to
// exercise the reworked slow path. Both verified against `git check-ignore`.
describe('globWithGitIgnore() nested-gitignore semantics (slow path)', () => {
  // A bare filename (no slash) in a nested .gitignore matches at any depth below
  // that directory, the way git applies it.
  it('honors a bare filename at any depth below its .gitignore', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'socket-glob-bare-'))
    try {
      mkdirSync(path.join(root, 'packages/a/sub'), { recursive: true })
      writeFileSync(path.join(root, 'package.json'), '{}')
      // The `!` line forces the slow path; it matches none of the manifests.
      writeFileSync(
        path.join(root, 'packages/a/.gitignore'),
        'secret.json\n!unused.keep\n',
      )
      writeFileSync(path.join(root, 'packages/a/package.json'), '{}')
      writeFileSync(path.join(root, 'packages/a/sub/secret.json'), '{}')
      writeFileSync(path.join(root, 'packages/a/sub/keep.json'), '{}')

      const results = await globWithGitIgnore(['**/*'], {
        cwd: root,
        filter: jsonFilter,
      })
      const rel = results.map(p => normalizePath(path.relative(root, p))).sort()
      expect(rel).toEqual([
        'package.json',
        'packages/a/package.json',
        'packages/a/sub/keep.json',
      ])
      expect(rel).not.toContain('packages/a/sub/secret.json')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  // A file cannot be re-included if a parent directory is excluded: a root
  // `build/` keeps everything under build/ ignored even when a deeper .gitignore
  // negates a specific file.
  it('does not re-include a file under a parent-excluded directory', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'socket-glob-reinc-'))
    try {
      mkdirSync(path.join(root, 'packages/a/build'), { recursive: true })
      writeFileSync(path.join(root, 'package.json'), '{}')
      writeFileSync(path.join(root, '.gitignore'), 'build/\n')
      writeFileSync(
        path.join(root, 'packages/a/.gitignore'),
        '!build/important.json\n',
      )
      writeFileSync(path.join(root, 'packages/a/build/important.json'), '{}')

      const results = await globWithGitIgnore(['**/*'], {
        cwd: root,
        filter: jsonFilter,
      })
      const rel = results.map(p => normalizePath(path.relative(root, p))).sort()
      expect(rel).toEqual(['package.json'])
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  // Built-in directory excludes must still apply on the slow path, where the
  // matcher chain covers only gitignore/projectIgnore patterns: a pyvenv.cfg
  // virtualenv with a non-conventional name (caught via venvGlobs) and a static
  // IGNORED_DIRS entry like `coverage` that is absent from defaultIgnore.
  it('excludes built-in ignored dirs (venv, coverage) on the slow path', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'socket-glob-venv-'))
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
      const rel = results.map(p => normalizePath(path.relative(root, p))).sort()
      expect(rel).toEqual(['package.json'])
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})
