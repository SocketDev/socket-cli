/**
 * @file Unit tests for `_shared/foreign-paths.mts`. Covers the pure helpers
 *   (isUntrackedByDefault, addTouchedFromBash, parsePorcelain) and the
 *   mtime/touched classification of listForeignDirtyPaths against a real git
 *   repo in tmpdir, using the injectable `now` / `maxAgeMs` to exercise the
 *   recency window the child-process hook tests can't easily reach.
 */

import assert from 'node:assert/strict'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  addTouchedFromBash,
  isUntrackedByDefault,
  listForeignDirtyPaths,
  parsePorcelain,
} from '../foreign-paths.mts'

test('isUntrackedByDefault matches vendored trees + *-bundled', () => {
  assert.equal(isUntrackedByDefault('vendor/dep.js'), true)
  assert.equal(isUntrackedByDefault('upstream/x/y.c'), true)
  assert.equal(isUntrackedByDefault('pkg-bundled/a.js'), true)
  assert.equal(isUntrackedByDefault('src/index.ts'), false)
})

test('addTouchedFromBash collects surgical add/mv/rm paths, skips broad forms', () => {
  const touched = new Set<string>()
  addTouchedFromBash('git add a.ts b.ts && git rm c.ts', touched)
  assert.equal(touched.has(path.resolve('a.ts')), true)
  assert.equal(touched.has(path.resolve('b.ts')), true)
  assert.equal(touched.has(path.resolve('c.ts')), true)
  const broad = new Set<string>()
  addTouchedFromBash('git add -A', broad)
  addTouchedFromBash('git add .', broad)
  assert.equal(broad.size, 0)
})

test('parsePorcelain drops untracked-by-default + resolves renames', () => {
  const out = ' M src/a.ts\n?? vendor/x.js\nR  old.ts -> new.ts\n'
  const entries = parsePorcelain(out)
  const paths = entries.map(e => e.path)
  assert.deepEqual(paths, ['src/a.ts', 'new.ts'])
})

test('listForeignDirtyPaths: recent + untouched = foreign; touched or stale = excluded', () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'fp-repo-'))
  try {
    spawnSync('git', ['init', '-q'], { cwd: repo })
    const theirs = path.join(repo, 'theirs.txt')
    const mine = path.join(repo, 'mine.txt')
    const stale = path.join(repo, 'stale.txt')
    writeFileSync(theirs, 'x')
    writeFileSync(mine, 'x')
    writeFileSync(stale, 'x')
    const now = Date.now()
    // Backdate stale.txt an hour so it falls outside a 30-min window.
    const old = (now - 60 * 60 * 1000) / 1000
    utimesSync(stale, old, old)

    const touched = new Set<string>([path.resolve(mine)])
    const foreign = listForeignDirtyPaths(repo, touched, {
      now,
      maxAgeMs: 30 * 60 * 1000,
    })
    assert.equal(foreign.includes('theirs.txt'), true)
    assert.equal(foreign.includes('mine.txt'), false)
    assert.equal(foreign.includes('stale.txt'), false)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})
