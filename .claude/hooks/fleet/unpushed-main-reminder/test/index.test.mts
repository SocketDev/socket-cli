// node --test specs for unpushed-main-reminder's pure helpers. Drives a
// throwaway git repo in a temp dir (scoped GIT_CONFIG_* so it never touches a
// real config) so it never touches the live repo.

import assert from 'node:assert/strict'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { commitsAhead, currentBranch, isDefaultBranch } from '../index.mts'

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
function makeClone(): { dir: string; cleanup: () => void } {
  const root = mkdtempSync(path.join(os.tmpdir(), 'unpushed-main-test-'))
  const origin = path.join(root, 'origin.git')
  const clone = path.join(root, 'clone')
  git(root, ['init', '--bare', '-b', 'main', origin])
  git(root, ['clone', origin, clone])
  git(clone, ['commit', '--allow-empty', '-m', 'initial'])
  git(clone, ['push', 'origin', 'main'])
  return {
    dir: clone,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

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

test('commitsAhead is 0 when in sync with origin', () => {
  const { cleanup, dir } = makeClone()
  try {
    assert.equal(commitsAhead(dir, 'main'), 0)
  } finally {
    cleanup()
  }
})

test('commitsAhead counts local-only commits ahead of origin', () => {
  const { cleanup, dir } = makeClone()
  try {
    git(dir, ['commit', '--allow-empty', '-m', 'local only 1'])
    git(dir, ['commit', '--allow-empty', '-m', 'local only 2'])
    assert.equal(commitsAhead(dir, 'main'), 2)
  } finally {
    cleanup()
  }
})

test('commitsAhead returns 0 when no origin upstream exists', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'unpushed-main-noorigin-'))
  try {
    git(root, ['init', '-b', 'main', root])
    git(root, ['commit', '--allow-empty', '-m', 'initial'])
    assert.equal(commitsAhead(root, 'main'), 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
