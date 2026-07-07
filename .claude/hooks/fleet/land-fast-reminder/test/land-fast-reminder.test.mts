// node --test specs for land-fast-reminder's pure helpers. Drives throwaway
// git repos in temp dirs (scoped GIT_CONFIG_* so they never touch a real
// config or the live repo).

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  aheadBehind,
  currentBranch,
  isDefaultBranch,
  isDiverged,
} from '../index.mts'

const GIT_ENV = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'T',
  GIT_AUTHOR_EMAIL: 't@e.x',
  GIT_COMMITTER_NAME: 'T',
  GIT_COMMITTER_EMAIL: 't@e.x',
}

function git(cwd: string, args: readonly string[]): void {
  spawnSync('git', args as string[], {
    cwd,
    env: { ...process.env, ...GIT_ENV },
    stdio: 'pipe',
  })
}

// Build a bare origin + a clone on `main` tracking origin/main, in sync.
function makeClone(): { dir: string; origin: string; cleanup: () => void } {
  const root = mkdtempSync(path.join(os.tmpdir(), 'land-fast-test-'))
  const origin = path.join(root, 'origin.git')
  const clone = path.join(root, 'clone')
  git(root, ['init', '--bare', '-b', 'main', origin])
  git(root, ['clone', origin, clone])
  git(clone, ['commit', '--allow-empty', '-m', 'initial'])
  git(clone, ['push', 'origin', 'main'])
  return {
    dir: clone,
    origin,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

// A SECOND clone that pushes a commit to origin, so the first clone can fall
// "behind" after a fetch.
function pushFromSecondClone(origin: string, tmpRoot: string): void {
  const other = path.join(
    tmpRoot,
    `other-${Math.random().toString(36).slice(2)}`,
  )
  git(tmpRoot, ['clone', origin, other])
  git(other, ['commit', '--allow-empty', '-m', 'remote-side commit'])
  git(other, ['push', 'origin', 'main'])
}

// ── currentBranch / isDefaultBranch ─────────────────────────────

test('currentBranch returns main on a fresh clone', () => {
  const { cleanup, dir } = makeClone()
  try {
    assert.equal(currentBranch(dir), 'main')
  } finally {
    cleanup()
  }
})

test('isDefaultBranch recognizes main, rejects a feature branch', () => {
  const { cleanup, dir } = makeClone()
  try {
    assert.equal(isDefaultBranch(dir, 'main'), true)
    assert.equal(isDefaultBranch(dir, 'feature'), false)
  } finally {
    cleanup()
  }
})

// ── isDiverged (pure) ───────────────────────────────────────────

test('isDiverged is true only when BOTH ahead and behind', () => {
  assert.equal(isDiverged({ ahead: 2, behind: 3 }), true)
  assert.equal(isDiverged({ ahead: 1, behind: 0 }), false) // ahead-only
  assert.equal(isDiverged({ ahead: 0, behind: 1 }), false) // behind-only
  assert.equal(isDiverged({ ahead: 0, behind: 0 }), false) // in sync
})

// ── aheadBehind (against a real repo) ───────────────────────────

test('aheadBehind is 0/0 on a fresh in-sync clone (NOT diverged)', () => {
  const { cleanup, dir } = makeClone()
  try {
    const counts = aheadBehind(dir, 'main')
    assert.deepEqual(counts, { ahead: 0, behind: 0 })
    assert.equal(isDiverged(counts!), false)
  } finally {
    cleanup()
  }
})

test('aheadBehind reports ahead-only after a local commit (NOT diverged)', () => {
  const { cleanup, dir } = makeClone()
  try {
    git(dir, ['commit', '--allow-empty', '-m', 'local only'])
    const counts = aheadBehind(dir, 'main')
    assert.equal(counts?.ahead, 1)
    assert.equal(counts?.behind, 0)
    assert.equal(isDiverged(counts!), false)
  } finally {
    cleanup()
  }
})

test('aheadBehind reports DIVERGED when local + origin both moved', () => {
  const { cleanup, dir, origin } = makeClone()
  const tmpRoot = path.dirname(origin)
  try {
    // Local commit (ahead) ...
    git(dir, ['commit', '--allow-empty', '-m', 'local only'])
    // ... and a remote-side commit (behind, after fetch).
    pushFromSecondClone(origin, tmpRoot)
    git(dir, ['fetch', 'origin', 'main'])
    const counts = aheadBehind(dir, 'main')
    assert.equal(counts?.ahead, 1)
    assert.equal(counts?.behind, 1)
    assert.equal(isDiverged(counts!), true)
  } finally {
    cleanup()
  }
})

test('aheadBehind reports behind-only after a remote commit (NOT diverged)', () => {
  const { cleanup, dir, origin } = makeClone()
  const tmpRoot = path.dirname(origin)
  try {
    pushFromSecondClone(origin, tmpRoot)
    git(dir, ['fetch', 'origin', 'main'])
    const counts = aheadBehind(dir, 'main')
    assert.equal(counts?.ahead, 0)
    assert.equal(counts?.behind, 1)
    assert.equal(isDiverged(counts!), false)
  } finally {
    cleanup()
  }
})
