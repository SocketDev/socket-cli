// node --test specs for check-hook-reminder-guard-overlap.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  findOverlap,
  sharedPrefixSegments,
} from '../check-hook-reminder-guard-overlap.mts'

test('sharedPrefixSegments counts the common leading run', () => {
  assert.equal(
    sharedPrefixSegments(['claude', 'md', 'size'], ['claude', 'md', 'prefer']),
    2,
  )
  assert.equal(sharedPrefixSegments(['path'], ['path', 'regex', 'x']), 1)
  assert.equal(sharedPrefixSegments(['a', 'b'], ['x', 'y']), 0)
})

test('flags an exact base-name collision as an error', () => {
  const { exactCollisions } = findOverlap([
    'prose-antipattern-guard',
    'prose-antipattern-reminder',
  ])
  assert.deepEqual(exactCollisions, ['prose-antipattern'])
})

test('no collision when only a guard or only a reminder exists', () => {
  const { exactCollisions } = findOverlap([
    'prose-antipattern-guard',
    'voice-and-tone-reminder',
  ])
  assert.equal(exactCollisions.length, 0)
})

test('a 2-segment shared prefix is an advisory pair, not an error', () => {
  const report = findOverlap([
    'claude-md-size-guard',
    'claude-md-prefer-external-detail-reminder',
  ])
  assert.equal(report.exactCollisions.length, 0)
  assert.equal(report.prefixPairs.length, 1)
  assert.equal(report.prefixPairs[0]!.prefix, 'claude-md')
})

test('a single shared segment is NOT flagged (too coarse)', () => {
  // path-guard / path-regex-normalize-reminder share only "path".
  const { prefixPairs } = findOverlap([
    'path-guard',
    'path-regex-normalize-reminder',
  ])
  assert.equal(prefixPairs.length, 0)
})

test('an exact collision is not also reported as a prefix pair', () => {
  const { exactCollisions, prefixPairs } = findOverlap([
    'foo-bar-guard',
    'foo-bar-reminder',
  ])
  assert.deepEqual(exactCollisions, ['foo-bar'])
  assert.equal(prefixPairs.length, 0)
})

test('ignores non-guard/reminder hook names', () => {
  const report = findOverlap([
    'setup-firewall',
    'token-minifier-start',
    'sweep-ds-store',
  ])
  assert.equal(report.exactCollisions.length, 0)
  assert.equal(report.prefixPairs.length, 0)
})
