/**
 * @file Unit tests for no-command-regex-in-hooks-guard's pure detectors.
 *   findCommandRegexes flags regex literals that parse a shell command (a shell
 *   binary next to a whitespace/boundary metachar); isHookFile scopes the guard
 *   to .claude/hooks/ TS files.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { findCommandRegexes, isHookFile } from '../index.mts'

test('flags a git-push command regex', () => {
  const f = findCommandRegexes(String.raw`if (/\bgit\s+push\b/.test(cmd)) {}`)
  assert.equal(f.length, 1)
  assert.equal(f[0]!.binary, 'git')
})

test('flags a gh pr regex', () => {
  const f = findCommandRegexes(String.raw`const RE = /\bgh\s+pr\s+create\b/`)
  assert.equal(f.length, 1)
  assert.equal(f[0]!.binary, 'gh')
})

test('flags a pnpm command regex with ` +` spacing', () => {
  const f = findCommandRegexes(String.raw`/(?:^|\s)pnpm +run\b/`)
  assert.equal(f.length, 1)
  assert.equal(f[0]!.binary, 'pnpm')
})

test('does NOT flag a non-command regex (a version string)', () => {
  const f = findCommandRegexes(String.raw`const V = /^\d+\.\d+\.\d+$/`)
  assert.equal(f.length, 0)
})

test('does NOT flag a regex that merely contains a binary name without a boundary metachar', () => {
  // Matching a path segment like "gitignore" is not command parsing.
  const f = findCommandRegexes(String.raw`/gitignore/`)
  assert.equal(f.length, 0)
})

test('does NOT flag plain prose mentioning git push', () => {
  const f = findCommandRegexes('// we run git push here as a comment')
  assert.equal(f.length, 0)
})

test('isHookFile: true for a fleet hook TS file', () => {
  assert.equal(isHookFile('/r/.claude/hooks/fleet/some-guard/index.mts'), true)
})

test('isHookFile: false outside .claude/hooks', () => {
  assert.equal(isHookFile('/r/src/process/spawn/child.ts'), false)
})

test('isHookFile: false for this guard’s own files (self-exempt)', () => {
  assert.equal(
    isHookFile(
      '/r/.claude/hooks/fleet/no-command-regex-in-hooks-guard/index.mts',
    ),
    false,
  )
})

test('isHookFile: false for node_modules', () => {
  assert.equal(
    isHookFile('/r/.claude/hooks/fleet/x/node_modules/dep/index.mts'),
    false,
  )
})
