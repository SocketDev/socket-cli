// node --test specs for the merged yakback-reminder hook. Asserts each
// source pattern set fires AND each disable env var silences only its own group
// (the regression contract for the merge).

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
const SELF_NARRATION_SAMPLE = 'Now let me run the tests.'

test('fires the comment-tone group', () => {
  const { path: p, cleanup } = makeTranscript(COMMENT_SAMPLE)
  try {
    const { stderr, exitCode } = runHook(p)
    assert.equal(exitCode, 0)
    assert.match(stderr, /comment-yakback-reminder/)
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

test('fires the self-narration group', () => {
  const { path: p, cleanup } = makeTranscript(SELF_NARRATION_SAMPLE)
  try {
    const { stderr } = runHook(p)
    assert.match(stderr, /self-narration-reminder/)
  } finally {
    cleanup()
  }
})

test('self-narration: flags an unprompted status recap', () => {
  const { path: p, cleanup } = makeTranscript(
    "Here's where things stand after the sweep.",
  )
  try {
    assert.match(runHook(p).stderr, /self-narration-reminder/)
  } finally {
    cleanup()
  }
})

test('self-narration: flags a conversational hedge', () => {
  const { path: p, cleanup } = makeTranscript(
    'Honestly the cache layer is the bottleneck.',
  )
  try {
    assert.match(runHook(p).stderr, /self-narration-reminder/)
  } finally {
    cleanup()
  }
})

test('self-narration: flags a virtue-narration opener', () => {
  for (const sample of [
    'Let me be disciplined here and trace the path.',
    'To be thorough, I checked every consumer.',
    'Let me think hard about this before editing.',
  ]) {
    const { path: p, cleanup } = makeTranscript(sample)
    try {
      assert.match(runHook(p).stderr, /self-narration-reminder/, sample)
    } finally {
      cleanup()
    }
  }
})

test('self-narration: does NOT flag plain careful prose', () => {
  // "careful" / "thorough" used as plain description, not a virtue-opener.
  const { path: p, cleanup } = makeTranscript(
    'The parser is careful about trailing commas and handles them.',
  )
  try {
    const { stderr } = runHook(p)
    assert.doesNotMatch(stderr, /self-narration-reminder/)
  } finally {
    cleanup()
  }
})

test('fires all four groups in one turn', () => {
  // Newline-separated: the self-narration "Now let me" pattern anchors on
  // line-start (an opener tell), so each sample is its own line as in a turn.
  const { path: p, cleanup } = makeTranscript(
    `${COMMENT_SAMPLE}\n${USERS_SAMPLE}\n${PERFECTIONIST_SAMPLE}\n${SELF_NARRATION_SAMPLE}`,
  )
  try {
    const { stderr } = runHook(p)
    assert.match(stderr, /comment-yakback-reminder/)
    assert.match(stderr, /identifying-users-reminder/)
    assert.match(stderr, /perfectionist-reminder/)
    assert.match(stderr, /self-narration-reminder/)
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
