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
  gitVerbIndex,
  isUntrackedByDefault,
  listForeignDirtyPaths,
  parsePorcelain,
  readLedgerPaths,
  readSessionTouchedPaths,
  recordTouchedFromBash,
  recordTouchedPath,
  touchedLedgerPath,
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

test('gitVerbIndex skips git global options to reach the subcommand', () => {
  // start index points at the `git` token.
  assert.equal(gitVerbIndex(['git', 'mv', 'a', 'b'], 0), 1)
  // `-C <dir>` consumes a value token.
  assert.equal(gitVerbIndex(['git', '-C', '/r', 'mv', 'a', 'b'], 0), 3)
  // `-c key=val` consumes a value token (no `=` on the flag itself).
  assert.equal(gitVerbIndex(['git', '-c', 'core.x=1', 'add', 'a'], 0), 3)
  // Inline `--git-dir=…` is one token.
  assert.equal(gitVerbIndex(['git', '--git-dir=/r/.git', 'add', 'a'], 0), 2)
  // Spaced `--git-dir <dir>` consumes a value token.
  assert.equal(gitVerbIndex(['git', '--git-dir', '/r/.git', 'add', 'a'], 0), 3)
  // Bare flag (`--no-pager`) consumes only itself.
  assert.equal(gitVerbIndex(['git', '--no-pager', 'mv', 'a', 'b'], 0), 2)
  // Multiple global opts stacked.
  assert.equal(gitVerbIndex(['git', '-C', '/r', '-c', 'u.e=x', 'mv'], 0), 5)
  // No subcommand present → tokens.length.
  assert.equal(gitVerbIndex(['git', '-C', '/r'], 0), 3)
})

test('addTouchedFromBash credits authorship under `git -C <repo> mv` (the parallel-safe form)', () => {
  const touched = new Set<string>()
  addTouchedFromBash('git -C /repo mv old/a.mts new/a.mts', touched)
  // Repo-relative args resolve against the `-C` base, not the hook cwd.
  assert.equal(touched.has(path.resolve('/repo', 'old/a.mts')), true)
  assert.equal(touched.has(path.resolve('/repo', 'new/a.mts')), true)
})

test('addTouchedFromBash handles -c config + --git-dir before the verb', () => {
  const a = new Set<string>()
  addTouchedFromBash('git -c user.email=x@y.z add src/a.ts', a)
  assert.equal(a.has(path.resolve('src/a.ts')), true)
  const b = new Set<string>()
  addTouchedFromBash('git --git-dir=/r/.git rm src/b.ts', b)
  assert.equal(b.has(path.resolve('src/b.ts')), true)
})

test('addTouchedFromBash: -C base applies to multiple paths + chained segments', () => {
  const touched = new Set<string>()
  addTouchedFromBash(
    'git -C /repo mv a.mts b.mts && git -C /repo add c.mts',
    touched,
  )
  assert.equal(touched.has(path.resolve('/repo', 'a.mts')), true)
  assert.equal(touched.has(path.resolve('/repo', 'b.mts')), true)
  assert.equal(touched.has(path.resolve('/repo', 'c.mts')), true)
})

test('addTouchedFromBash: broad forms still skipped even under git -C', () => {
  const touched = new Set<string>()
  addTouchedFromBash('git -C /repo add -A', touched)
  addTouchedFromBash('git -C /repo add .', touched)
  assert.equal(touched.size, 0)
})

test('addTouchedFromBash: a global flag that is not a verb does not misfire', () => {
  // `--no-pager status` is not add/mv/rm — nothing is touched.
  const touched = new Set<string>()
  addTouchedFromBash('git --no-pager status', touched)
  assert.equal(touched.size, 0)
})

test('touchedLedgerPath: stable per transcript, distinct across sessions, undefined without one', () => {
  assert.equal(touchedLedgerPath(undefined), undefined)
  const a1 = touchedLedgerPath('/sessions/aaa.jsonl')
  const a2 = touchedLedgerPath('/sessions/aaa.jsonl')
  const b = touchedLedgerPath('/sessions/bbb.jsonl')
  assert.equal(a1, a2) // same session → same ledger
  assert.notEqual(a1, b) // different session → different ledger
  assert.ok(a1!.endsWith('.paths'))
})

test('recordTouchedPath + readLedgerPaths: a recorded path is read back (survives transcript lag)', () => {
  // Unique transcript path per test → isolated ledger file.
  const tp = path.join(os.tmpdir(), `ledger-test-${process.pid}-A.jsonl`)
  const ledger = touchedLedgerPath(tp)!
  try {
    assert.equal(readLedgerPaths(tp).size, 0) // none yet
    recordTouchedPath(tp, '/repo/a.mts')
    recordTouchedPath(tp, 'relative/b.mts') // resolved to absolute on write
    const got = readLedgerPaths(tp)
    assert.equal(got.has('/repo/a.mts'), true)
    assert.equal(got.has(path.resolve('relative/b.mts')), true)
  } finally {
    rmSync(ledger, { force: true })
  }
})

test('recordTouchedPath is a no-op without a transcript path (fail-open)', () => {
  // Should not throw and should write nothing discoverable.
  recordTouchedPath(undefined, '/repo/x.mts')
  assert.equal(readLedgerPaths(undefined).size, 0)
})

test('recordTouchedFromBash records git mv/add/rm targets to the ledger (closes gitMv→Edit gap)', () => {
  const tp = path.join(os.tmpdir(), `ledger-test-${process.pid}-C.jsonl`)
  const ledger = touchedLedgerPath(tp)!
  try {
    recordTouchedFromBash(tp, 'git -C /repo mv old/a.mts new/a.mts')
    const got = readLedgerPaths(tp)
    // Both rename endpoints land in the ledger so the next Edit to `new` sees it.
    assert.equal(got.has(path.resolve('/repo', 'old/a.mts')), true)
    assert.equal(got.has(path.resolve('/repo', 'new/a.mts')), true)
  } finally {
    rmSync(ledger, { force: true })
  }
})

test('recordTouchedFromBash records nothing for a non-add/mv/rm command', () => {
  const tp = path.join(os.tmpdir(), `ledger-test-${process.pid}-D.jsonl`)
  const ledger = touchedLedgerPath(tp)!
  try {
    recordTouchedFromBash(tp, 'git -C /repo status')
    assert.equal(readLedgerPaths(tp).size, 0)
  } finally {
    rmSync(ledger, { force: true })
  }
})

test('recordTouchedFromBash is a no-op without a transcript path (fail-open)', () => {
  recordTouchedFromBash(undefined, 'git mv a.mts b.mts')
  assert.equal(readLedgerPaths(undefined).size, 0)
})

test('readSessionTouchedPaths unions transcript authorship with the same-turn ledger', () => {
  const tp = path.join(os.tmpdir(), `ledger-test-${process.pid}-B.jsonl`)
  const ledger = touchedLedgerPath(tp)!
  try {
    // No transcript file on disk → transcript half is empty; ledger half fills.
    recordTouchedPath(tp, '/repo/ledgered.mts')
    const got = readSessionTouchedPaths(tp)
    assert.equal(got.has('/repo/ledgered.mts'), true)
  } finally {
    rmSync(ledger, { force: true })
  }
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

test('listForeignDirtyPaths: a staged rename is never foreign (git-mv blind spot)', () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'fp-rename-'))
  try {
    spawnSync('git', ['init', '-q'], { cwd: repo })
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo })
    spawnSync('git', ['config', 'user.name', 'test'], { cwd: repo })
    const oldPath = path.join(repo, 'old.txt')
    writeFileSync(oldPath, 'x')
    spawnSync('git', ['add', 'old.txt'], { cwd: repo })
    spawnSync('git', ['commit', '-qm', 'add old', '--no-gpg-sign'], {
      cwd: repo,
    })
    // Stage a rename. The destination is deliberately NOT in `touched` —
    // mirroring a `git mv` whose target path was variable-expanded in the
    // Bash command, so addTouchedFromBash couldn't capture the literal.
    spawnSync('git', ['mv', 'old.txt', 'new.txt'], { cwd: repo })
    const foreign = listForeignDirtyPaths(repo, new Set<string>(), {
      now: Date.now(),
      maxAgeMs: 30 * 60 * 1000,
    })
    // Status is `R  old.txt -> new.txt` — a staged rename, this session's
    // deliberate move, not a parallel agent's loose edit.
    assert.equal(foreign.includes('new.txt'), false)
    assert.equal(foreign.includes('old.txt'), false)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})
