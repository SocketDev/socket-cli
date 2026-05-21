import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from '@socketsecurity/lib-stable/spawn/spawn'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK_PATH = path.join(__dirname, '..', 'index.mts')

function makeTranscript(assistantText: string): {
  path: string
  cleanup: () => void
} {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'comment-tone-'))
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

test('flags "first, we will" teacher-tone preamble', () => {
  const { path: p, cleanup } = makeTranscript('First, we will parse the input.')
  try {
    const { stderr, exitCode } = runHook(p)
    assert.equal(exitCode, 0)
    assert.match(stderr, /comment-tone-reminder/)
    assert.match(stderr, /first, we/)
  } finally {
    cleanup()
  }
})

test('flags "note that" tutorial filler', () => {
  const { path: p, cleanup } = makeTranscript(
    'Note that the parser caches results.',
  )
  try {
    const { stderr } = runHook(p)
    assert.match(stderr, /note that/)
  } finally {
    cleanup()
  }
})

test('flags "in order to" wordiness', () => {
  const { path: p, cleanup } = makeTranscript(
    'We use a cache in order to avoid recomputation.',
  )
  try {
    const { stderr } = runHook(p)
    assert.match(stderr, /in order to/)
  } finally {
    cleanup()
  }
})

test('does not flag plain prose', () => {
  const { path: p, cleanup } = makeTranscript(
    'The cache stores parsed results keyed by input.',
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
    'Plain output here.\n```\nnote that this is in code\n```\nMore prose.',
  )
  try {
    const { stderr } = runHook(p)
    assert.equal(stderr, '')
  } finally {
    cleanup()
  }
})

test('disabled env var short-circuits', () => {
  const { path: p, cleanup } = makeTranscript('Note that we should skip this.')
  try {
    const result = spawnSync('node', [HOOK_PATH], {
      input: JSON.stringify({ transcript_path: p }),
      env: { ...process.env, SOCKET_COMMENT_TONE_REMINDER_DISABLED: '1' },
    })
    assert.equal(result.status, 0)
    assert.equal(result.stderr, '')
  } finally {
    cleanup()
  }
})
