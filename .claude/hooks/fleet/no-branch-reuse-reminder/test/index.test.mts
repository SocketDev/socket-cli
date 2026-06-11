/**
 * @file Unit tests for no-branch-reuse-reminder's pure helpers.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { isGitCommit } from '../index.mts'

test('isGitCommit: plain git commit', () => {
  assert.equal(isGitCommit('git commit -m "fix: foo"'), true)
})

test('isGitCommit: git commit with --all', () => {
  assert.equal(isGitCommit('git add foo && git commit -m "x"'), true)
})

test('isGitCommit: git commit --amend is excluded', () => {
  // Amending is a different operation; not flagged.
  assert.equal(isGitCommit('git commit --amend --no-edit'), false)
})

test('isGitCommit: git push is not a commit', () => {
  assert.equal(isGitCommit('git push origin main'), false)
})

test('isGitCommit: git status is not a commit', () => {
  assert.equal(isGitCommit('git status'), false)
})

test('isGitCommit: grep "git commit" is not a commit (parser, not regex)', () => {
  // The shell-command.mts parser correctly identifies the binary as
  // `grep`, not `git` — confirming AST-based detection avoids the
  // literal-string false positive that regex would hit.
  assert.equal(isGitCommit('grep "git commit" CHANGELOG.md'), false)
})
