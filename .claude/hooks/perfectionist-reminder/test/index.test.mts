// @ts-expect-error - node:test types via @types/node@catalog work at runtime
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK_PATH = path.join(__dirname, '..', 'index.mts')

function makeTranscript(assistantText: string): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'perfectionist-'))
  const transcriptPath = path.join(dir, 'session.jsonl')
  const lines = [
    JSON.stringify({ role: 'user', content: 'hi' }),
    JSON.stringify({ role: 'assistant', content: assistantText }),
  ].join('\n')
  writeFileSync(transcriptPath, lines)
  return { path: transcriptPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function runHook(transcriptPath: string): { stderr: string; exitCode: number } {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify({ transcript_path: transcriptPath }),
    encoding: 'utf8',
  })
  return { stderr: result.stderr, exitCode: result.status ?? -1 }
}

test('flags Option A / Option B depth-vs-speed menu', () => {
  const { path: p, cleanup } = makeTranscript(
    'Option A (depth): I do 4-5 hooks well. Option B (speed): I ship all 12 with regex-only.',
  )
  try {
    const { stderr, exitCode } = runHook(p)
    assert.equal(exitCode, 0)
    assert.match(stderr, /perfectionist-reminder/)
    assert.match(stderr, /option/i)
  } finally {
    cleanup()
  }
})

test('flags maximally useful vs maximally shipped', () => {
  const { path: p, cleanup } = makeTranscript(
    'Should I go for maximally useful (proper) or maximally shipped (fast)?',
  )
  try {
    const { stderr } = runHook(p)
    assert.match(stderr, /maximally/)
  } finally {
    cleanup()
  }
})

test('flags ship-it precision framing', () => {
  const { path: p, cleanup } = makeTranscript(
    'I could do this with ship-it precision and iterate later.',
  )
  try {
    const { stderr } = runHook(p)
    assert.match(stderr, /ship-it/)
  } finally {
    cleanup()
  }
})

test('flags speed vs depth phrasing', () => {
  const { path: p, cleanup } = makeTranscript(
    'This is a speed vs depth question — which way?',
  )
  try {
    const { stderr } = runHook(p)
    assert.match(stderr, /speed/i)
  } finally {
    cleanup()
  }
})

test('flags "if you say A / if you say B" binary choice', () => {
  const { path: p, cleanup } = makeTranscript(
    'If you say A I will do all 12 properly. If you say B I will ship regex-only.',
  )
  try {
    const { stderr } = runHook(p)
    assert.match(stderr, /if you say/i)
  } finally {
    cleanup()
  }
})

test('does not flag plain technical prose', () => {
  const { path: p, cleanup } = makeTranscript(
    'The cache stores parsed results keyed by file path. Each entry expires after 10 minutes.',
  )
  try {
    const { stderr, exitCode } = runHook(p)
    assert.equal(exitCode, 0)
    assert.equal(stderr, '')
  } finally {
    cleanup()
  }
})

test('does not false-positive on phrases inside code fences', () => {
  const { path: p, cleanup } = makeTranscript(
    'Plain output here.\n```\nspeed vs depth (this is in code)\n```\nMore prose.',
  )
  try {
    const { stderr } = runHook(p)
    assert.equal(stderr, '')
  } finally {
    cleanup()
  }
})

test('disabled env var short-circuits', () => {
  const { path: p, cleanup } = makeTranscript('Option A (depth) or Option B (speed)?')
  try {
    const result = spawnSync('node', [HOOK_PATH], {
      input: JSON.stringify({ transcript_path: p }),
      encoding: 'utf8',
      env: { ...process.env, SOCKET_PERFECTIONIST_REMINDER_DISABLED: '1' },
    })
    assert.equal(result.status, 0)
    assert.equal(result.stderr, '')
  } finally {
    cleanup()
  }
})
