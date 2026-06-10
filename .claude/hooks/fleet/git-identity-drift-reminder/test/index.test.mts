// node --test specs for the git-identity-drift-reminder Stop hook.

import test from 'node:test'
import assert from 'node:assert/strict'

import { formatReminder, shouldRemind } from '../index.mts'

test('shouldRemind: fires on the real incident (agent-ci@example.com)', () => {
  assert.equal(shouldRemind('agent-ci@example.com'), true)
})

test('shouldRemind: fires on test fixtures + reserved domains', () => {
  assert.equal(shouldRemind('test@example.com'), true)
  assert.equal(shouldRemind('x@localhost'), true)
})

test('shouldRemind: passes a real identity', () => {
  assert.equal(shouldRemind('john.david.dalton@gmail.com'), false)
  assert.equal(shouldRemind('jdalton@socket.dev'), false)
})

test('shouldRemind: passes empty (no identity set)', () => {
  assert.equal(shouldRemind(''), false)
})

test('formatReminder: global fallback path suggests --local --unset', () => {
  const msg = formatReminder('agent-ci@example.com', true)
  assert.match(msg, /git-identity-drift-reminder/)
  assert.match(msg, /agent-ci@example\.com/)
  assert.match(msg, /required_signatures/)
  assert.match(msg, /git config --local --unset user\.email/)
})

test('formatReminder: no-global path suggests --global set', () => {
  const msg = formatReminder('agent-ci@example.com', false)
  assert.match(msg, /git config --global user\.email/)
  assert.doesNotMatch(msg, /--local --unset/)
})

test('formatReminder: reminds to re-author committed work', () => {
  const msg = formatReminder('test@example.com', true)
  assert.match(msg, /--amend --reset-author/)
})
