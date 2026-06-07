/**
 * @file Unit tests for primary-checkout-branch-guard's pure helpers. The
 *   primary-vs-worktree check (isPrimaryCheckout) spawns git, so it's covered
 *   by behavior, not unit-tested here; branchOpKind / firstBranchOp are the
 *   parsing core.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { branchOpKind, firstBranchOp } from '../index.mts'

test('branchOpKind: checkout -b is create', () => {
  assert.equal(branchOpKind(['checkout', '-b', 'feature']), 'create')
})

test('branchOpKind: checkout -B is create', () => {
  assert.equal(branchOpKind(['checkout', '-B', 'feature']), 'create')
})

test('branchOpKind: switch -c is create', () => {
  assert.equal(branchOpKind(['switch', '-c', 'feature']), 'create')
})

test('branchOpKind: switch -C is create', () => {
  assert.equal(branchOpKind(['switch', '-C', 'feature']), 'create')
})

test('branchOpKind: switch <name> is switch', () => {
  assert.equal(branchOpKind(['switch', 'main']), 'switch')
})

test('branchOpKind: checkout <branch> is switch', () => {
  assert.equal(branchOpKind(['checkout', 'main']), 'switch')
})

test('branchOpKind: checkout -- <file> is a file restore (allowed)', () => {
  assert.equal(branchOpKind(['checkout', '--', 'src/foo.mts']), undefined)
})

test('branchOpKind: checkout . is a working-tree restore (allowed)', () => {
  assert.equal(branchOpKind(['checkout', '.']), undefined)
})

test('branchOpKind: bare switch with only flags is ignored', () => {
  assert.equal(branchOpKind(['switch', '--detach']), undefined)
})

test('branchOpKind: bare checkout with no positional is ignored', () => {
  assert.equal(branchOpKind(['checkout']), undefined)
})

test('branchOpKind: non-branch git subcommand is ignored', () => {
  assert.equal(branchOpKind(['status']), undefined)
  assert.equal(branchOpKind(['commit', '-m', 'x']), undefined)
})

test('firstBranchOp: detects checkout -b in a command string', () => {
  assert.deepEqual(firstBranchOp('git checkout -b fix/foo'), { kind: 'create' })
})

test('firstBranchOp: detects switch <name>', () => {
  assert.deepEqual(firstBranchOp('git switch main'), { kind: 'switch' })
})

test('firstBranchOp: git status returns undefined', () => {
  assert.equal(firstBranchOp('git status'), undefined)
})

test('firstBranchOp: file restore returns undefined', () => {
  assert.equal(firstBranchOp('git checkout -- src/foo.mts'), undefined)
})

test('firstBranchOp: parser not regex — grep "git checkout" is not a git op', () => {
  // shell-command.mts resolves the binary as grep, not git.
  assert.equal(firstBranchOp('grep "git checkout -b" notes.md'), undefined)
})

test('firstBranchOp: detects op in a chained command', () => {
  assert.deepEqual(firstBranchOp('git fetch && git checkout -b fix/x'), {
    kind: 'create',
  })
})
