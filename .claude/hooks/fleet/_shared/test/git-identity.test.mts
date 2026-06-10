/**
 * @file Unit tests for `_shared/git-identity.mts`. Covers the pure
 *   placeholder-email classifier (the patterns shared by git-config-write-guard
 *   and git-identity-drift-reminder). The git-config-reading helpers
 *   (effectiveUserEmail / hasGlobalIdentity) shell out and are exercised through
 *   the consuming hooks' integration tests, not here.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isPlaceholderEmail } from '../git-identity.mts'

test('isPlaceholderEmail: flags the real incident (agent-ci@example.com)', () => {
  assert.equal(isPlaceholderEmail('agent-ci@example.com'), true)
})

test('isPlaceholderEmail: flags test fixtures + reserved domains', () => {
  assert.equal(isPlaceholderEmail('test@example.com'), true)
  assert.equal(isPlaceholderEmail('x@example.org'), true)
  assert.equal(isPlaceholderEmail('y@example.net'), true)
  assert.equal(isPlaceholderEmail('bot@ci.example'), true)
})

test('isPlaceholderEmail: flags localhost / invalid / test pseudo-domains', () => {
  assert.equal(isPlaceholderEmail('x@localhost'), true)
  assert.equal(isPlaceholderEmail('x@invalid'), true)
  assert.equal(isPlaceholderEmail('x@test'), true)
})

test('isPlaceholderEmail: passes real human / org emails', () => {
  assert.equal(isPlaceholderEmail('john.david.dalton@gmail.com'), false)
  assert.equal(isPlaceholderEmail('jdalton@socket.dev'), false)
  assert.equal(isPlaceholderEmail('dev@company.io'), false)
})

test('isPlaceholderEmail: empty / whitespace is not a placeholder', () => {
  assert.equal(isPlaceholderEmail(''), false)
  assert.equal(isPlaceholderEmail('   '), false)
})

test('isPlaceholderEmail: a domain merely CONTAINING example as a label is not reserved', () => {
  // `example-corp.com` and `myexample.com` are real domains, not RFC-2606
  // reserved ones; the \b boundary keeps them out.
  assert.equal(isPlaceholderEmail('a@example-corp.com'), false)
  assert.equal(isPlaceholderEmail('a@myexample.com'), false)
})
