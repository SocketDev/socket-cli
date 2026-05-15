import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK_PATH = path.join(__dirname, '..', 'index.mts')

interface Turn {
  readonly role: 'user' | 'assistant'
  readonly text: string
}

function makeTranscript(turns: readonly Turn[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'stopguard-'))
  const transcriptPath = path.join(dir, 'session.jsonl')
  const lines: string[] = []
  for (let i = 0, { length } = turns; i < length; i += 1) {
    const t = turns[i]!
    lines.push(JSON.stringify({ role: t.role, content: t.text }))
  }
  writeFileSync(transcriptPath, lines.join('\n'))
  return transcriptPath
}

function runHook(
  transcriptPath: string,
  extraEnv: Record<string, string> = {},
): { stderr: string; exitCode: number } {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify({ transcript_path: transcriptPath }),
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  })
  return { stderr: result.stderr, exitCode: result.status ?? -1 }
}

test('FLAGS "stopping here" without user authorization', () => {
  const transcriptPath = makeTranscript([
    { role: 'user', text: 'complete each one in the queue' },
    { role: 'assistant', text: 'Done with item 1. Stopping here for now.' },
  ])
  const { stderr, exitCode } = runHook(transcriptPath)
  assert.equal(exitCode, 0)
  assert.match(stderr, /dont-stop-mid-queue-reminder/)
  assert.match(stderr, /stopping here/i)
})

test('FLAGS "honest stopping point"', () => {
  const transcriptPath = makeTranscript([
    { role: 'user', text: 'hammer through the list' },
    {
      role: 'assistant',
      text: 'Item 3 complete. This feels like an honest stopping point.',
    },
  ])
  const { stderr, exitCode } = runHook(transcriptPath)
  assert.equal(exitCode, 0)
  assert.match(stderr, /honest.*stopping point/i)
})

test('FLAGS "what\'s next?"', () => {
  const transcriptPath = makeTranscript([
    { role: 'user', text: 'work the queue' },
    { role: 'assistant', text: 'Done with task A. What\'s next?' },
  ])
  const { stderr, exitCode } = runHook(transcriptPath)
  assert.equal(exitCode, 0)
  assert.match(stderr, /what's next/i)
})

test('FLAGS "want me to continue?"', () => {
  const transcriptPath = makeTranscript([
    { role: 'user', text: 'do them all' },
    { role: 'assistant', text: 'Hook built. Want me to continue with the next one?' },
  ])
  const { stderr, exitCode } = runHook(transcriptPath)
  assert.equal(exitCode, 0)
  assert.match(stderr, /want me to continue/i)
})

test('FLAGS "pick a next item"', () => {
  const transcriptPath = makeTranscript([
    { role: 'user', text: 'go through the list' },
    {
      role: 'assistant',
      text: 'I\'ve finished hook 5. Pick the next item from the queue.',
    },
  ])
  const { stderr, exitCode } = runHook(transcriptPath)
  assert.equal(exitCode, 0)
  assert.match(stderr, /pick.*next.*item/i)
})

test('FLAGS "Want me to pick one and continue, or take them in order?"', () => {
  const transcriptPath = makeTranscript([
    { role: 'user', text: 'what is left' },
    {
      role: 'assistant',
      text: 'Three items left:\n- A\n- B\n- C\n\nWant me to pick one and continue, or take them in order?',
    },
  ])
  const { stderr, exitCode } = runHook(transcriptPath)
  assert.equal(exitCode, 0)
  assert.match(stderr, /pick.*continue|take.*order/i)
})

test('FLAGS "which one first?" menu', () => {
  const transcriptPath = makeTranscript([
    { role: 'user', text: 'fix the bugs' },
    {
      role: 'assistant',
      text: 'Three bugs found. Which one first?',
    },
  ])
  const { stderr, exitCode } = runHook(transcriptPath)
  assert.equal(exitCode, 0)
  assert.match(stderr, /which.*first/i)
})

test('FLAGS "should I start with X?"', () => {
  const transcriptPath = makeTranscript([
    { role: 'user', text: 'do them all' },
    {
      role: 'assistant',
      text: 'A list of items: foo, bar, baz. Should I start with foo?',
    },
  ])
  const { stderr, exitCode } = runHook(transcriptPath)
  assert.equal(exitCode, 0)
  assert.match(stderr, /should.*start/i)
})

test('FLAGS pending-list followed by trailing question', () => {
  const transcriptPath = makeTranscript([
    { role: 'user', text: 'hammer it out' },
    {
      role: 'assistant',
      text: 'Still pending:\n- item A\n- item B\n- item C\n\nWhere should I focus?',
    },
  ])
  const { stderr, exitCode } = runHook(transcriptPath)
  assert.equal(exitCode, 0)
  assert.match(stderr, /menu question|still pending/i)
})

test('FLAGS "session totals"', () => {
  const transcriptPath = makeTranscript([
    { role: 'user', text: '100%, all of them' },
    {
      role: 'assistant',
      text: 'Session totals: 7 hooks landed, 3 remaining. Done for now.',
    },
  ])
  const { stderr, exitCode } = runHook(transcriptPath)
  assert.equal(exitCode, 0)
  assert.match(stderr, /session totals/i)
})

test('FLAGS "remaining queue:" with bulleted list', () => {
  const transcriptPath = makeTranscript([
    { role: 'user', text: 'complete each' },
    {
      role: 'assistant',
      text: 'Hook 7 done.\n\nRemaining queue:\n- hook 8\n- hook 9\n- hook 10',
    },
  ])
  const { stderr, exitCode } = runHook(transcriptPath)
  assert.equal(exitCode, 0)
  assert.match(stderr, /remaining queue/i)
})

test('FLAGS "Holding here." trailing turn', () => {
  const transcriptPath = makeTranscript([
    { role: 'user', text: 'continue through the queue' },
    {
      role: 'assistant',
      text: 'Hook 4 landed and tests pass. Holding here.',
    },
  ])
  const { stderr, exitCode } = runHook(transcriptPath)
  assert.equal(exitCode, 0)
  assert.match(stderr, /holding/i)
})

test('FLAGS "Holding for next direction."', () => {
  const transcriptPath = makeTranscript([
    { role: 'user', text: 'work the list' },
    {
      role: 'assistant',
      text: 'Item complete. Holding for next direction.',
    },
  ])
  const { stderr, exitCode } = runHook(transcriptPath)
  assert.equal(exitCode, 0)
  assert.match(stderr, /holding/i)
})

test('FLAGS "I\'ll hold pending your call"', () => {
  const transcriptPath = makeTranscript([
    { role: 'user', text: 'do them all' },
    {
      role: 'assistant',
      text: 'Tier 2 work complete. I\'ll hold pending your call on which one is next.',
    },
  ])
  const { stderr, exitCode } = runHook(transcriptPath)
  assert.equal(exitCode, 0)
  assert.match(stderr, /holding|hold/i)
})

test('FLAGS "Waiting for your direction"', () => {
  const transcriptPath = makeTranscript([
    { role: 'user', text: 'hammer through' },
    {
      role: 'assistant',
      text: 'Done with patch 17. Waiting for your direction on the next item.',
    },
  ])
  const { stderr, exitCode } = runHook(transcriptPath)
  assert.equal(exitCode, 0)
  assert.match(stderr, /waiting.*direction/i)
})

test('FLAGS "Ready when you are."', () => {
  const transcriptPath = makeTranscript([
    { role: 'user', text: 'complete each one' },
    {
      role: 'assistant',
      text: 'All three hooks landed. Ready when you are.',
    },
  ])
  const { stderr, exitCode } = runHook(transcriptPath)
  assert.equal(exitCode, 0)
  assert.match(stderr, /ready when you/i)
})

test('FLAGS "standing by"', () => {
  const transcriptPath = makeTranscript([
    { role: 'user', text: '100% complete' },
    {
      role: 'assistant',
      text: 'Phase landed. Standing by.',
    },
  ])
  const { stderr, exitCode } = runHook(transcriptPath)
  assert.equal(exitCode, 0)
  assert.match(stderr, /standing by/i)
})

test('does NOT fire on technical "holding the lock"', () => {
  const transcriptPath = makeTranscript([
    { role: 'user', text: 'explain how this mutex works' },
    {
      role: 'assistant',
      text: 'The worker is holding the lock during write, releasing on drop.',
    },
  ])
  const { stderr, exitCode } = runHook(transcriptPath)
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

test('SKIPS when user said "stop" in recent turn', () => {
  const transcriptPath = makeTranscript([
    { role: 'user', text: 'okay let\'s stop here for today' },
    { role: 'assistant', text: 'Stopping here. Session summary follows.' },
  ])
  const { stderr, exitCode } = runHook(transcriptPath)
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

test('SKIPS when user said "pause"', () => {
  const transcriptPath = makeTranscript([
    { role: 'user', text: 'pause for a sec, I need to check something' },
    { role: 'assistant', text: 'Sure, pausing here.' },
  ])
  const { stderr, exitCode } = runHook(transcriptPath)
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

test('SKIPS when user said "we\'re done"', () => {
  const transcriptPath = makeTranscript([
    { role: 'user', text: 'okay we\'re done for today' },
    { role: 'assistant', text: 'Got it. Final session state below.' },
  ])
  const { stderr, exitCode } = runHook(transcriptPath)
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

test('SKIPS when user said "enough for now"', () => {
  const transcriptPath = makeTranscript([
    { role: 'user', text: 'that\'s enough for now' },
    { role: 'assistant', text: 'Understood. Stopping here.' },
  ])
  const { stderr, exitCode } = runHook(transcriptPath)
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

test('does NOT fire on innocuous text', () => {
  const transcriptPath = makeTranscript([
    { role: 'user', text: 'list the files' },
    { role: 'assistant', text: 'Here are the files in the directory: a.ts, b.ts.' },
  ])
  const { stderr, exitCode } = runHook(transcriptPath)
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

test('ignores stopping phrases INSIDE code fences', () => {
  const transcriptPath = makeTranscript([
    { role: 'user', text: 'help me' },
    {
      role: 'assistant',
      text: 'Here is the docs:\n```\n// Stopping here is the natural stopping point.\n```\nDone.',
    },
  ])
  const { stderr, exitCode } = runHook(transcriptPath)
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

test('disabled env var short-circuits', () => {
  const transcriptPath = makeTranscript([
    { role: 'user', text: 'complete each one' },
    { role: 'assistant', text: 'Item 1 done. Stopping here.' },
  ])
  const { stderr, exitCode } = runHook(transcriptPath, {
    SOCKET_DONT_STOP_MID_QUEUE_REMINDER_DISABLED: '1',
  })
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

test('does not crash on missing transcript_path', () => {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify({}),
    encoding: 'utf8',
  })
  assert.equal(result.status, 0)
})

test('does not crash on malformed payload', () => {
  const result = spawnSync('node', [HOOK_PATH], {
    input: 'not-json',
    encoding: 'utf8',
  })
  assert.equal(result.status, 0)
})
