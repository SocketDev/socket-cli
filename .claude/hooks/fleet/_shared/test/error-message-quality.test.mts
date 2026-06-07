/**
 * @file Unit tests for the shared error-message-quality classifier — the single
 *   grading bar consumed by error-message-quality-reminder (Stop hook) and the
 *   error-messages-are-thorough check (commit-time).
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ERROR_CLASS_RE,
  gradeMessage,
  VAGUE_MESSAGE_PATTERNS,
} from '../error-message-quality.mts'

// ── vague-only → graded ─────────────────────────────────────────

test('grades bare "invalid"', () => {
  const g = gradeMessage('invalid')
  assert.ok(g)
  assert.match(g.label, /invalid/)
})

test('grades bare "failed" / "not found" / "something went wrong"', () => {
  assert.ok(gradeMessage('failed'))
  assert.ok(gradeMessage('not found'))
  assert.ok(gradeMessage('something went wrong'))
})

test('grades verb-only "could not read"', () => {
  assert.ok(gradeMessage('could not read'))
})

test('grading is case-insensitive + tolerates a trailing period', () => {
  assert.ok(gradeMessage('Invalid.'))
  assert.ok(gradeMessage('FAILED'))
})

// ── thorough → cleared ──────────────────────────────────────────

test('a message with a colon (field prefix) is cleared', () => {
  assert.equal(gradeMessage('config not found: /etc/app.yml'), undefined)
})

test('a message with a quoted shown value is cleared', () => {
  assert.equal(gradeMessage('must be one of "a" / "b"'), undefined)
})

test('a long specific message is cleared (> 40 chars)', () => {
  assert.equal(
    gradeMessage('the --port flag must be an integer between 1 and 65535'),
    undefined,
  )
})

test('"could not read <path>: <errno>" (object + reason) is cleared', () => {
  assert.equal(gradeMessage('could not read foo.txt: ENOENT'), undefined)
})

test('empty / whitespace message is out of scope', () => {
  assert.equal(gradeMessage(''), undefined)
  assert.equal(gradeMessage('   '), undefined)
})

// ── ERROR_CLASS_RE ──────────────────────────────────────────────

test('ERROR_CLASS_RE matches *Error classes + TemporalError', () => {
  assert.ok(ERROR_CLASS_RE.test('Error'))
  assert.ok(ERROR_CLASS_RE.test('TypeError'))
  assert.ok(ERROR_CLASS_RE.test('TemporalError'))
  assert.equal(ERROR_CLASS_RE.test('Logger'), false)
})

test('every pattern has a label + hint', () => {
  for (let i = 0, { length } = VAGUE_MESSAGE_PATTERNS; i < length; i += 1) {
    const p = VAGUE_MESSAGE_PATTERNS[i]!
    assert.ok(p.label.length > 0)
    assert.ok(p.hint.length > 0)
  }
})
