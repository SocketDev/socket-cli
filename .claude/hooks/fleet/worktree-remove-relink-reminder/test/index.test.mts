/**
 * @file Unit tests for isWorktreeRemoveOrPrune — the pure detector that decides
 *   whether a Bash command removed/pruned a git worktree (and thus may have
 *   dangled the main checkout's pnpm symlinks).
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { isWorktreeRemoveOrPrune } from '../index.mts'

// ── fires ───────────────────────────────────────────────────────

test('git worktree remove → true', () => {
  assert.equal(isWorktreeRemoveOrPrune('git worktree remove ../wt-foo'), true)
})

test('git worktree remove --force → true', () => {
  assert.equal(
    isWorktreeRemoveOrPrune('git worktree remove --force ../wt-foo'),
    true,
  )
})

test('git worktree prune → true', () => {
  assert.equal(isWorktreeRemoveOrPrune('git worktree prune'), true)
})

test('git -C <path> worktree remove → true (global option before subcommand)', () => {
  assert.equal(
    isWorktreeRemoveOrPrune('git -C /repo worktree remove ../wt'),
    true,
  )
})

test('chained command containing a worktree remove → true', () => {
  assert.equal(
    isWorktreeRemoveOrPrune('git push origin main && git worktree remove ../wt'),
    true,
  )
})

// ── does not fire ───────────────────────────────────────────────

test('git worktree add → false', () => {
  assert.equal(
    isWorktreeRemoveOrPrune('git worktree add -b fix ../wt origin/main'),
    false,
  )
})

test('git worktree list → false', () => {
  assert.equal(isWorktreeRemoveOrPrune('git worktree list'), false)
})

test('git worktree move → false', () => {
  assert.equal(isWorktreeRemoveOrPrune('git worktree move ../wt ../wt2'), false)
})

test('plain git push → false', () => {
  assert.equal(isWorktreeRemoveOrPrune('git push origin main'), false)
})

test('a quoted command in a message → false', () => {
  assert.equal(
    isWorktreeRemoveOrPrune('echo "remember to git worktree remove the wt"'),
    false,
  )
})

test('a non-git remove → false', () => {
  assert.equal(isWorktreeRemoveOrPrune('rm -rf ../wt-foo'), false)
})
