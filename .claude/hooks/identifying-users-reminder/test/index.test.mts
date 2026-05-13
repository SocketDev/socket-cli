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
  const dir = mkdtempSync(path.join(tmpdir(), 'identify-'))
  const transcriptPath = path.join(dir, 'session.jsonl')
  writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ role: 'user', content: 'hi' }),
      JSON.stringify({ role: 'assistant', content: assistantText }),
    ].join('\n'),
  )
  return { path: transcriptPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function runHook(transcriptPath: string): { stderr: string; exitCode: number } {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify({ transcript_path: transcriptPath }),
    encoding: 'utf8',
  })
  return { stderr: result.stderr, exitCode: result.status ?? -1 }
}

test('flags "the user wants" framing', () => {
  const { path: p, cleanup } = makeTranscript(
    'The user wants this fixed before the deadline.',
  )
  try {
    const { stderr, exitCode } = runHook(p)
    assert.equal(exitCode, 0)
    assert.match(stderr, /identifying-users-reminder/)
    assert.match(stderr, /the user/i)
  } finally {
    cleanup()
  }
})

test('flags "the user asked"', () => {
  const { path: p, cleanup } = makeTranscript(
    'Earlier the user asked about the cache implementation.',
  )
  try {
    const { stderr } = runHook(p)
    assert.match(stderr, /the user/i)
  } finally {
    cleanup()
  }
})

test('flags "this user prefers"', () => {
  const { path: p, cleanup } = makeTranscript(
    'This user prefers concise output.',
  )
  try {
    const { stderr } = runHook(p)
    assert.match(stderr, /this user/i)
  } finally {
    cleanup()
  }
})

test('flags "the developer wrote"', () => {
  const { path: p, cleanup } = makeTranscript(
    'The developer wrote this in haste.',
  )
  try {
    const { stderr } = runHook(p)
    assert.match(stderr, /developer/i)
  } finally {
    cleanup()
  }
})

test('flags sentence-initial "Someone asked"', () => {
  const { path: p, cleanup } = makeTranscript(
    'Someone asked about this earlier.',
  )
  try {
    const { stderr } = runHook(p)
    assert.match(stderr, /someone/i)
  } finally {
    cleanup()
  }
})

test('does NOT flag "you want" (direct address)', () => {
  const { path: p, cleanup } = makeTranscript(
    'You want this fixed before the deadline.',
  )
  try {
    const { stderr, exitCode } = runHook(p)
    assert.equal(exitCode, 0)
    assert.equal(stderr, '')
  } finally {
    cleanup()
  }
})

test('does NOT flag "the user can call X" (generic API description)', () => {
  const { path: p, cleanup } = makeTranscript(
    'The user can call X to get the result. The user must pass an object.',
  )
  try {
    const { stderr } = runHook(p)
    // "can call" / "must pass" aren't in the verb list — these are
    // generic API descriptions, not specific-intent references.
    assert.equal(stderr, '')
  } finally {
    cleanup()
  }
})

test('does NOT flag "users" plural', () => {
  const { path: p, cleanup } = makeTranscript(
    'Users wants different things. Most users wants speed.',
  )
  try {
    const { stderr } = runHook(p)
    // "users" plural doesn't match `the user` regex.
    assert.equal(stderr, '')
  } finally {
    cleanup()
  }
})

test('does NOT false-positive on phrases inside code fences', () => {
  const { path: p, cleanup } = makeTranscript(
    'Example:\n```\nthe user wants validation\n```\nPlain output here.',
  )
  try {
    const { stderr } = runHook(p)
    assert.equal(stderr, '')
  } finally {
    cleanup()
  }
})

test('disabled env var short-circuits', () => {
  const { path: p, cleanup } = makeTranscript('The user wants this.')
  try {
    const result = spawnSync('node', [HOOK_PATH], {
      input: JSON.stringify({ transcript_path: p }),
      encoding: 'utf8',
      env: { ...process.env, SOCKET_IDENTIFYING_USERS_REMINDER_DISABLED: '1' },
    })
    assert.equal(result.status, 0)
    assert.equal(result.stderr, '')
  } finally {
    cleanup()
  }
})
