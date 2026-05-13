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
  const dir = mkdtempSync(path.join(tmpdir(), 'judgment-'))
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

test('flags "I\'m not sure" hedge', () => {
  const { path: p, cleanup } = makeTranscript("I'm not sure which approach is better.")
  try {
    const { stderr, exitCode } = runHook(p)
    assert.equal(exitCode, 0)
    assert.match(stderr, /judgment-reminder/)
    assert.match(stderr, /I'm not sure|not sure/i)
  } finally {
    cleanup()
  }
})

test('flags "you decide" offload', () => {
  const { path: p, cleanup } = makeTranscript('Want me to do A or B? You decide.')
  try {
    const { stderr } = runHook(p)
    assert.match(stderr, /you decide/i)
  } finally {
    cleanup()
  }
})

test('flags "either approach works" false-equivalence', () => {
  const { path: p, cleanup } = makeTranscript('Either approach works for this case.')
  try {
    const { stderr } = runHook(p)
    assert.match(stderr, /either/i)
  } finally {
    cleanup()
  }
})

test('flags first-person modal hedge ("I could go either way")', () => {
  const { path: p, cleanup } = makeTranscript('I could go either way on this design.')
  try {
    const { stderr } = runHook(p)
    // Either the modal-hedge match OR the "either way" fixed phrase
    // (both correctly flag the same sentence; we accept either)
    assert.match(stderr, /modal-verb hedge|either/i)
  } finally {
    cleanup()
  }
})

test('does NOT flag technical conditional ("could throw")', () => {
  const { path: p, cleanup } = makeTranscript('The parser could throw if the input is malformed.')
  try {
    const { stderr, exitCode } = runHook(p)
    assert.equal(exitCode, 0)
    // The "could throw" use is a technical conditional, not a judgment
    // hedge — the regex pattern requires first-person subject + judgment
    // verb, so it should not match.
    assert.equal(stderr, '')
  } finally {
    cleanup()
  }
})

test('does not flag plain prose', () => {
  const { path: p, cleanup } = makeTranscript('The cache stores results keyed by file path.')
  try {
    const { stderr } = runHook(p)
    assert.equal(stderr, '')
  } finally {
    cleanup()
  }
})

test('does not false-positive on phrases inside code fences', () => {
  const { path: p, cleanup } = makeTranscript('Output:\n```\nI am not sure (in code)\n```\nPlain prose here.')
  try {
    const { stderr } = runHook(p)
    assert.equal(stderr, '')
  } finally {
    cleanup()
  }
})

test('disabled env var short-circuits', () => {
  const { path: p, cleanup } = makeTranscript("I'm not sure which approach.")
  try {
    const result = spawnSync('node', [HOOK_PATH], {
      input: JSON.stringify({ transcript_path: p }),
      encoding: 'utf8',
      env: { ...process.env, SOCKET_JUDGMENT_REMINDER_DISABLED: '1' },
    })
    assert.equal(result.status, 0)
    assert.equal(result.stderr, '')
  } finally {
    cleanup()
  }
})
