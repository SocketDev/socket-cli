// node --test specs for the merged prose-tone-reminder hook. Asserts each of
// the 3 source pattern sets still fires AND each disable env var silences only
// its own group (the regression contract for the merge).

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
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
  const dir = mkdtempSync(path.join(os.tmpdir(), 'prose-tone-'))
  const transcriptPath = path.join(dir, 'session.jsonl')
  writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ role: 'user', content: 'hi' }),
      JSON.stringify({ role: 'assistant', content: assistantText }),
    ].join('\n'),
  )
  return {
    path: transcriptPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

function runHook(
  transcriptPath: string,
  env?: Record<string, string>,
): { stderr: string; exitCode: number } {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify({ transcript_path: transcriptPath }),
    env: { ...process.env, ...env },
  })
  return { stderr: String(result.stderr), exitCode: result.status ?? -1 }
}

// One sample per source group.
const COMMENT_SAMPLE = 'Note that we parse the input here.'
const USERS_SAMPLE = 'The user wants the retries logged.'
const PERFECTIONIST_SAMPLE = 'Want speed vs depth here?'

test('fires the comment-tone group', () => {
  const { path: p, cleanup } = makeTranscript(COMMENT_SAMPLE)
  try {
    const { stderr, exitCode } = runHook(p)
    assert.equal(exitCode, 0)
    assert.match(stderr, /comment-tone-reminder/)
  } finally {
    cleanup()
  }
})

test('fires the identifying-users group', () => {
  const { path: p, cleanup } = makeTranscript(USERS_SAMPLE)
  try {
    const { stderr } = runHook(p)
    assert.match(stderr, /identifying-users-reminder/)
  } finally {
    cleanup()
  }
})

test('fires the perfectionist group', () => {
  const { path: p, cleanup } = makeTranscript(PERFECTIONIST_SAMPLE)
  try {
    const { stderr } = runHook(p)
    assert.match(stderr, /perfectionist-reminder/)
  } finally {
    cleanup()
  }
})

test('fires all three groups in one turn', () => {
  const { path: p, cleanup } = makeTranscript(
    `${COMMENT_SAMPLE} ${USERS_SAMPLE} ${PERFECTIONIST_SAMPLE}`,
  )
  try {
    const { stderr } = runHook(p)
    assert.match(stderr, /comment-tone-reminder/)
    assert.match(stderr, /identifying-users-reminder/)
    assert.match(stderr, /perfectionist-reminder/)
  } finally {
    cleanup()
  }
})

test('SOCKET_COMMENT_TONE_REMINDER_DISABLED silences only that group', () => {
  const { path: p, cleanup } = makeTranscript(
    `${COMMENT_SAMPLE} ${USERS_SAMPLE}`,
  )
  try {
    const { stderr } = runHook(p, {
      SOCKET_COMMENT_TONE_REMINDER_DISABLED: '1',
    })
    assert.doesNotMatch(stderr, /comment-tone-reminder/)
    assert.match(stderr, /identifying-users-reminder/)
  } finally {
    cleanup()
  }
})

test('SOCKET_PERFECTIONIST_REMINDER_DISABLED silences only that group', () => {
  const { path: p, cleanup } = makeTranscript(
    `${PERFECTIONIST_SAMPLE} ${USERS_SAMPLE}`,
  )
  try {
    const { stderr } = runHook(p, {
      SOCKET_PERFECTIONIST_REMINDER_DISABLED: '1',
    })
    assert.doesNotMatch(stderr, /perfectionist-reminder/)
    assert.match(stderr, /identifying-users-reminder/)
  } finally {
    cleanup()
  }
})

test('clean turn → exit 0, no output', () => {
  const { path: p, cleanup } = makeTranscript('Landed the fix and pushed.')
  try {
    const { stderr, exitCode } = runHook(p)
    assert.equal(exitCode, 0)
    assert.doesNotMatch(stderr, /reminder/)
  } finally {
    cleanup()
  }
})

test('fails open on malformed stdin', () => {
  const result = spawnSync('node', [HOOK_PATH], { input: 'not-json{' })
  assert.equal(result.status ?? -1, 0)
})
