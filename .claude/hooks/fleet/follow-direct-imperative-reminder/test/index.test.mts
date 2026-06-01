// node --test specs for follow-direct-imperative-reminder.

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { hasHedge, looksLikeImperative } from '../index.mts'

const HOOK = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'index.mts',
)

function runWithTurns(
  userText: string,
  assistantText: string,
): { stderr: string; exitCode: number } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'follow-imp-'))
  const transcriptPath = path.join(dir, 'session.jsonl')
  writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ role: 'user', content: userText }),
      JSON.stringify({ role: 'assistant', content: assistantText }),
    ].join('\n'),
  )
  try {
    const r = spawnSync('node', [HOOK], {
      input: JSON.stringify({ transcript_path: transcriptPath }),
    })
    return { stderr: String(r.stderr), exitCode: r.status ?? -1 }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('fires: imperative user + hedging assistant', () => {
  const { stderr, exitCode } = runWithTurns(
    'kill it',
    "That won't help — let me explain what's happening first.",
  )
  assert.equal(exitCode, 0)
  assert.match(stderr, /follow-direct-imperative-reminder/)
})

test('silent: imperative user + clean assistant', () => {
  const { stderr } = runWithTurns('kill it', 'Done. Killed the process.')
  assert.doesNotMatch(stderr, /follow-direct-imperative-reminder/)
})

test('silent: non-imperative user + hedging assistant', () => {
  const { stderr } = runWithTurns(
    'what do you think about the approach?',
    "Let me explain — that won't help.",
  )
  assert.doesNotMatch(stderr, /follow-direct-imperative-reminder/)
})

test('fails open on malformed stdin', () => {
  const r = spawnSync('node', [HOOK], { input: 'not-json{' })
  assert.equal(r.status ?? -1, 0)
})

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
