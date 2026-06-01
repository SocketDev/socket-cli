// node --test specs for the prose-antipattern-reminder hook.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { PROSE_PATTERNS } from '../patterns.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK_PATH = path.join(__dirname, '..', 'index.mts')

function makeTranscript(assistantText: string): {
  path: string
  cleanup: () => void
} {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'prose-antipattern-'))
  const transcriptPath = path.join(dir, 'session.jsonl')
  const lines = [
    JSON.stringify({ role: 'user', content: 'hi' }),
    JSON.stringify({ role: 'assistant', content: assistantText }),
  ].join('\n')
  writeFileSync(transcriptPath, lines)
  return {
    path: transcriptPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

function runHook(transcriptPath: string): {
  stdout: string
  stderr: string
  exitCode: number
} {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify({ transcript_path: transcriptPath }),
  })
  return {
    stdout: String(result.stdout),
    stderr: String(result.stderr),
    exitCode: result.status ?? -1,
  }
}

test('flags an em-dash chain (2+ spans)', () => {
  const { path: p, cleanup } = makeTranscript(
    'We ship it now — the gate is green — and move on.',
  )
  try {
    const { stderr, exitCode } = runHook(p)
    assert.equal(exitCode, 0)
    assert.match(stderr, /prose-antipattern-reminder/)
    assert.match(stderr, /em-dash chain/)
  } finally {
    cleanup()
  }
})

test('flags a throat-clearing opener', () => {
  const { path: p, cleanup } = makeTranscript(
    "Here's the thing about the cache layer.",
  )
  try {
    const { stderr } = runHook(p)
    assert.match(stderr, /throat-clearing opener/)
  } finally {
    cleanup()
  }
})

test('flags a "not X, it\'s Y" contrast', () => {
  const { path: p, cleanup } = makeTranscript(
    "This is not slow, it's the network round-trip.",
  )
  try {
    const { stderr } = runHook(p)
    assert.match(stderr, /contrast/)
  } finally {
    cleanup()
  }
})

test('flags a hedging adverb', () => {
  const { path: p, cleanup } = makeTranscript(
    'This is basically a thin wrapper around fetch.',
  )
  try {
    const { stderr } = runHook(p)
    assert.match(stderr, /hedging adverb/)
  } finally {
    cleanup()
  }
})

test('does not flag clean prose', () => {
  const { path: p, cleanup } = makeTranscript(
    'The cache stores parsed results keyed by input path.',
  )
  try {
    const { stderr, exitCode } = runHook(p)
    assert.equal(exitCode, 0)
    assert.equal(stderr, '')
  } finally {
    cleanup()
  }
})

test('does not flag a single em-dash', () => {
  const { path: p, cleanup } = makeTranscript(
    'The gate is green — we can ship.',
  )
  try {
    const { stderr } = runHook(p)
    assert.equal(stderr, '')
  } finally {
    cleanup()
  }
})

test('does not false-positive inside code fences', () => {
  const { path: p, cleanup } = makeTranscript(
    'Output below.\n```\nbasically just a stub — and another — chain\n```\nDone.',
  )
  try {
    const { stderr } = runHook(p)
    assert.equal(stderr, '')
  } finally {
    cleanup()
  }
})

test('disabled env var short-circuits', () => {
  const { path: p, cleanup } = makeTranscript('This is basically a wrapper.')
  try {
    const result = spawnSync('node', [HOOK_PATH], {
      input: JSON.stringify({ transcript_path: p }),
      env: { ...process.env, SOCKET_PROSE_ANTIPATTERN_REMINDER_DISABLED: '1' },
    })
    assert.equal(result.status, 0)
    assert.equal(result.stderr, '')
  } finally {
    cleanup()
  }
})

test('exported patterns match their target shapes', () => {
  const byLabel = new Map(PROSE_PATTERNS.map(p => [p.label, p.regex]))
  assert.equal(byLabel.size, 4)
  assert.match('a — b — c', byLabel.get('em-dash chain')!)
  assert.doesNotMatch('a — b', byLabel.get('em-dash chain')!)
  assert.match('Let me explain', byLabel.get('throat-clearing opener')!)
  assert.match(
    "not fast, it's slow",
    byLabel.get('"not X, it\'s Y" contrast')!,
  )
  assert.match('essentially done', byLabel.get('hedging adverb')!)
})
