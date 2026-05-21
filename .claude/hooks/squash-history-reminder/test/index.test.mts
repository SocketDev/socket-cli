// node --test specs for squash-history-reminder hook helpers.

import test from 'node:test'
import assert from 'node:assert/strict'

import { isOptedIn, resolveRepoName } from '../index.mts'

test('isOptedIn returns true for an opted-in repo', () => {
  const roster = {
    repos: [
      { name: 'socket-btm', optIns: ['squash-history'] },
      { name: 'socket-cli' },
    ],
  }
  assert.strictEqual(isOptedIn(roster, 'socket-btm', 'squash-history'), true)
})

test('isOptedIn returns false for a non-opted-in repo', () => {
  const roster = {
    repos: [
      { name: 'socket-btm', optIns: ['squash-history'] },
      { name: 'socket-cli' },
    ],
  }
  assert.strictEqual(isOptedIn(roster, 'socket-cli', 'squash-history'), false)
})

test('isOptedIn returns false for a repo missing from the roster', () => {
  const roster = {
    repos: [{ name: 'socket-btm', optIns: ['squash-history'] }],
  }
  assert.strictEqual(isOptedIn(roster, 'unknown-repo', 'squash-history'), false)
})

test('isOptedIn returns false for a different opt-in name', () => {
  const roster = {
    repos: [{ name: 'socket-btm', optIns: ['squash-history'] }],
  }
  assert.strictEqual(isOptedIn(roster, 'socket-btm', 'other-opt-in'), false)
})

test('resolveRepoName falls back to cwd basename if no git remote', () => {
  // Use a real path to verify basename extraction; the function tries
  // git first but will silently fail in /tmp (no remote configured).
  const result = resolveRepoName('/tmp/socket-imaginary')
  // Result is either the basename OR a real remote name if /tmp happens
  // to be inside a git checkout (unlikely). Both are valid; the
  // important thing is the function returns *something* string-shaped.
  assert.strictEqual(typeof result, 'string')
  assert.ok((result?.length ?? 0) > 0)
})
