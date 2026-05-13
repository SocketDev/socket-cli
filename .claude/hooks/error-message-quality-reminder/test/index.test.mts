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
  const dir = mkdtempSync(path.join(tmpdir(), 'errmsg-'))
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

test('flags bare "invalid" in code block', () => {
  const { path: p, cleanup } = makeTranscript(
    'Here is the change:\n```ts\nthrow new Error("invalid")\n```',
  )
  try {
    const { stderr, exitCode } = runHook(p)
    assert.equal(exitCode, 0)
    assert.match(stderr, /error-message-quality-reminder/)
    assert.match(stderr, /invalid/)
  } finally {
    cleanup()
  }
})

test('flags bare "failed"', () => {
  const { path: p, cleanup } = makeTranscript(
    '```ts\nthrow new TypeError("failed")\n```',
  )
  try {
    const { stderr } = runHook(p)
    assert.match(stderr, /failed/)
  } finally {
    cleanup()
  }
})

test('flags "something went wrong"', () => {
  const { path: p, cleanup } = makeTranscript(
    '```\nthrow new Error("something went wrong")\n```',
  )
  try {
    const { stderr } = runHook(p)
    assert.match(stderr, /something went wrong/)
  } finally {
    cleanup()
  }
})

test('flags "unable to X" verb-only', () => {
  const { path: p, cleanup } = makeTranscript(
    '```\nthrow new Error("unable to read")\n```',
  )
  try {
    const { stderr } = runHook(p)
    assert.match(stderr, /unable to/i)
  } finally {
    cleanup()
  }
})

test('does NOT flag good messages with field-path prefix', () => {
  const { path: p, cleanup } = makeTranscript(
    '```ts\nthrow new RangeError("user.email: must be lowercase")\n```',
  )
  try {
    const { stderr, exitCode } = runHook(p)
    assert.equal(exitCode, 0)
    assert.equal(stderr, '')
  } finally {
    cleanup()
  }
})

test('does NOT flag good messages with quoted value', () => {
  const { path: p, cleanup } = makeTranscript(
    '```\nthrow new Error(`config file not found: ${path}`)\n```',
  )
  try {
    const { stderr } = runHook(p)
    assert.equal(stderr, '')
  } finally {
    cleanup()
  }
})

test('does NOT flag long messages (>40 chars)', () => {
  const { path: p, cleanup } = makeTranscript(
    '```\nthrow new Error("the configuration file could not be parsed because of a syntax error")\n```',
  )
  try {
    const { stderr } = runHook(p)
    assert.equal(stderr, '')
  } finally {
    cleanup()
  }
})

test('does NOT flag throws in plain prose (not in code fence)', () => {
  const { path: p, cleanup } = makeTranscript(
    'I will throw new Error("invalid") if that case happens.',
  )
  try {
    const { stderr } = runHook(p)
    assert.equal(stderr, '')
  } finally {
    cleanup()
  }
})

test('handles multiple throws in same code block', () => {
  const { path: p, cleanup } = makeTranscript(
    '```\nif (x) throw new Error("invalid")\nif (y) throw new Error("failed")\n```',
  )
  try {
    const { stderr } = runHook(p)
    assert.match(stderr, /invalid/)
    assert.match(stderr, /failed/)
  } finally {
    cleanup()
  }
})

test('handles multiple code blocks', () => {
  const { path: p, cleanup } = makeTranscript(
    'First:\n```\nthrow new Error("invalid")\n```\nSecond:\n```\nthrow new TypeError("bad")\n```',
  )
  try {
    const { stderr } = runHook(p)
    assert.match(stderr, /invalid/)
    assert.match(stderr, /bad/)
  } finally {
    cleanup()
  }
})

test('disabled env var short-circuits', () => {
  const { path: p, cleanup } = makeTranscript(
    '```\nthrow new Error("invalid")\n```',
  )
  try {
    const result = spawnSync('node', [HOOK_PATH], {
      input: JSON.stringify({ transcript_path: p }),
      encoding: 'utf8',
      env: { ...process.env, SOCKET_ERROR_MESSAGE_QUALITY_REMINDER_DISABLED: '1' },
    })
    assert.equal(result.status, 0)
    assert.equal(result.stderr, '')
  } finally {
    cleanup()
  }
})
