// node --test specs for the shared fleet-repos membership helpers.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  FLEET_REPO_NAMES,
  isFleetRepo,
  slugFromRemoteUrl,
} from '../fleet-repos.mts'

test('FLEET_REPO_NAMES includes the broad membership set', () => {
  // ultrathink is a fleet member but NOT in the cascade roster
  // (fleet-repos.json) — the broad set must carry it.
  assert.ok(FLEET_REPO_NAMES.includes('ultrathink'))
  assert.ok(FLEET_REPO_NAMES.includes('socket-cli'))
  assert.ok(FLEET_REPO_NAMES.includes('socket-wheelhouse'))
})

test('FLEET_REPO_NAMES is sorted + has no duplicates', () => {
  const sorted = [...FLEET_REPO_NAMES].toSorted()
  assert.deepStrictEqual([...FLEET_REPO_NAMES], sorted)
  assert.strictEqual(new Set(FLEET_REPO_NAMES).size, FLEET_REPO_NAMES.length)
})

test('isFleetRepo: member names pass', () => {
  assert.ok(isFleetRepo('socket-cli'))
  assert.ok(isFleetRepo('ultrathink'))
})

test('isFleetRepo: case-insensitive', () => {
  assert.ok(isFleetRepo('Socket-CLI'))
  assert.ok(isFleetRepo('ULTRATHINK'))
})

test('isFleetRepo: non-members fail', () => {
  assert.ok(!isFleetRepo('depot'))
  assert.ok(!isFleetRepo('some-personal-repo'))
  assert.ok(!isFleetRepo(''))
})

test('slugFromRemoteUrl: SSH scp-like form', () => {
  assert.strictEqual(
    slugFromRemoteUrl('git@github.com:SocketDev/socket-cli.git'),
    'socket-cli',
  )
})

test('slugFromRemoteUrl: SSH URL form', () => {
  assert.strictEqual(
    slugFromRemoteUrl('ssh://git@github.com/SocketDev/socket-lib.git'),
    'socket-lib',
  )
})

test('slugFromRemoteUrl: HTTPS form with .git', () => {
  assert.strictEqual(
    slugFromRemoteUrl('https://github.com/SocketDev/ultrathink.git'),
    'ultrathink',
  )
})

test('slugFromRemoteUrl: HTTPS form without .git', () => {
  assert.strictEqual(
    slugFromRemoteUrl('https://github.com/SocketDev/depot'),
    'depot',
  )
})

test('slugFromRemoteUrl: trailing slash tolerated', () => {
  assert.strictEqual(
    slugFromRemoteUrl('https://github.com/SocketDev/depot/'),
    'depot',
  )
})

test('slugFromRemoteUrl: lowercases the slug', () => {
  assert.strictEqual(
    slugFromRemoteUrl('git@github.com:SocketDev/Socket-CLI.git'),
    'socket-cli',
  )
})

test('slugFromRemoteUrl: a fork under a different owner still yields the slug', () => {
  // Owner is dropped on purpose — a fork is still not a fleet push target,
  // and isFleetRepo keys on the bare name.
  assert.strictEqual(
    slugFromRemoteUrl('git@github.com:someuser/socket-cli.git'),
    'socket-cli',
  )
})

test('slugFromRemoteUrl: unrecognized input → undefined', () => {
  assert.strictEqual(slugFromRemoteUrl(''), undefined)
  assert.strictEqual(slugFromRemoteUrl('   '), undefined)
  assert.strictEqual(slugFromRemoteUrl('not-a-url'), undefined)
})
