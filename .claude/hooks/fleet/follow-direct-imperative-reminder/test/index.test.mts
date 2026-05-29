// node --test specs for follow-direct-imperative-reminder.

import test from 'node:test'
import assert from 'node:assert/strict'

import { flattenContent, hasHedge, looksLikeImperative } from '../index.mts'

test('looksLikeImperative: "use nvm 26.2.0"', () => {
  assert.strictEqual(looksLikeImperative('use nvm 26.2.0'), true)
})

test('looksLikeImperative: "cancel the build right now"', () => {
  assert.strictEqual(looksLikeImperative('cancel the build right now'), true)
})

test('looksLikeImperative: "kill it"', () => {
  assert.strictEqual(looksLikeImperative('kill it'), true)
})

test('looksLikeImperative: "do what I said"', () => {
  assert.strictEqual(looksLikeImperative('do what I said'), true)
})

test('looksLikeImperative: "continue"', () => {
  assert.strictEqual(looksLikeImperative('continue'), true)
})

test('looksLikeImperative: rejects questions', () => {
  assert.strictEqual(looksLikeImperative('should I use 26?'), false)
})

test('looksLikeImperative: rejects long context', () => {
  assert.strictEqual(
    looksLikeImperative(
      'use nvm to switch to Node 26.2.0 so the build runs with the right engines',
    ),
    false,
  )
})

test('looksLikeImperative: rejects non-verb opener', () => {
  assert.strictEqual(looksLikeImperative('hey there friend'), false)
  assert.strictEqual(looksLikeImperative('thanks for that'), false)
})

test('looksLikeImperative: empty', () => {
  assert.strictEqual(looksLikeImperative(''), false)
  assert.strictEqual(looksLikeImperative('   '), false)
})

test('hasHedge: "doesn\'t help"', () => {
  assert.strictEqual(
    hasHedge(
      "Switching the shell's Node to 26.2.0 doesn't help the build that's already running",
    ),
    true,
  )
})

test('hasHedge: "Before I do that"', () => {
  assert.strictEqual(
    hasHedge('Before I do that, the in-flight build is at 37%.'),
    true,
  )
})

test('hasHedge: "Let me explain"', () => {
  assert.strictEqual(hasHedge('Let me explain why this fails.'), true)
})

test('hasHedge: "actually,"', () => {
  assert.strictEqual(hasHedge('actually, the dependency graph shows…'), true)
})

test('hasHedge: clean status update', () => {
  assert.strictEqual(hasHedge('Switched. Now on Node 26.2.0.'), false)
})

test('hasHedge: tool result narration', () => {
  assert.strictEqual(hasHedge('Build cancelled. No processes remain.'), false)
})

test('flattenContent: string', () => {
  assert.strictEqual(flattenContent('hi'), 'hi')
})

test('flattenContent: text blocks', () => {
  assert.strictEqual(
    flattenContent([
      { type: 'text', text: 'one' },
      { type: 'text', text: 'two' },
    ]),
    'one\ntwo',
  )
})

test('flattenContent: ignores non-text blocks', () => {
  assert.strictEqual(
    flattenContent([
      { type: 'tool_use', name: 'Bash' },
      { type: 'text', text: 'survives' },
    ]),
    'survives',
  )
})

test('flattenContent: empty/garbage', () => {
  assert.strictEqual(flattenContent(undefined), '')
  assert.strictEqual(flattenContent(42), '')
  assert.strictEqual(flattenContent(undefined), '')
})
