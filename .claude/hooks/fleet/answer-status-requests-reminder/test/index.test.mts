/**
 * @file node --test specs for the answer-status-requests-reminder hook. Stop
 *   hook that NUDGES (never blocks): it writes a stderr reminder when the most
 *   recent user turn asks for a status update AND the most recent assistant turn
 *   declined with a rate-limiting excuse ("too soon", "skipping", "polling is
 *   wasted", …). Reminder semantics — every path exits 0; "fires" means a
 *   non-empty stderr nudge, "passes" means empty stderr. The hook reads ONLY the
 *   most recent user turn (n=1) and the most recent assistant turn. It has NO
 *   bypass phrase. Fail-open on malformed stdin / missing transcript.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

const NUDGE = /\[answer-status-requests-reminder\]/

type Result = { code: number; stderr: string }

async function runHook(payload: Record<string, unknown>): Promise<Result> {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  void child.catch(() => undefined)
  child.stdin!.end(JSON.stringify(payload))
  let stderr = ''
  child.process.stderr!.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  return new Promise(resolve => {
    child.process.on('exit', code => {
      resolve({ code: code ?? 0, stderr })
    })
  })
}

// Build a two-turn JSONL transcript: one user line, one assistant line. The
// hook reads the most-recent user turn for the status-request match and the
// most-recent assistant turn for the decline match.
function makeTranscript(userText: string, assistantText: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'answer-status-test-'))
  const file = path.join(dir, 'session.jsonl')
  const lines = [
    JSON.stringify({ role: 'user', content: userText }),
    JSON.stringify({ role: 'assistant', content: assistantText }),
  ]
  writeFileSync(file, lines.join('\n'))
  return file
}

async function run(
  userText: string,
  assistantText: string,
): Promise<Result> {
  const transcript = makeTranscript(userText, assistantText)
  return runHook({ transcript_path: transcript })
}

// FIRES — one case per distinct decline shape the hook catches, each paired
// with a status request so both conditions hold.

test('fires: "check status" + "too soon"', async () => {
  const result = await run(
    'check status',
    "It's too soon since the last check, let me hold off.",
  )
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
})

test('fires: "status?" + last-check-N-minutes-ago', async () => {
  const result = await run(
    'status?',
    'My last check was ~2 minutes ago so nothing has changed.',
  )
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
})

test('fires: "status update" + "skipping,"', async () => {
  const result = await run(
    'give me a status update please',
    "Skipping, since I just looked a moment ago.",
  )
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
})

test('fires: "how is it going" + "not enough time has passed"', async () => {
  const result = await run(
    'how is it going',
    'Not enough time has passed for a fresh result yet.',
  )
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
})

test("fires: \"how's the build going\" + \"I'll wait\"", async () => {
  const result = await run(
    "how's the build going",
    "I'll wait a bit before polling again.",
  )
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
})

test('fires: "is it done" + "no need to check"', async () => {
  const result = await run(
    'is it done',
    'There is no need to check yet, it was just started.',
  )
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
})

test('fires: "still running?" + "polling is wasted"', async () => {
  const result = await run(
    'still running?',
    'Polling is wasted here, the cache has not refreshed.',
  )
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
})

test('fires: "where are we" + "no change since last check"', async () => {
  const result = await run(
    'where are we on this',
    'There is no change since the last check, so I held off.',
  )
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
})

test('fires: "any updates" + "too early"', async () => {
  const result = await run(
    'any updates',
    'Too early to tell, give it a moment.',
  )
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
})

test('fires: "progress?" + "too soon"', async () => {
  const result = await run(
    'progress?',
    'Too soon to report anything useful right now.',
  )
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, NUDGE)
})

// DOES-NOT-FIRE — user asked for status, but the assistant actually answered
// (no decline phrase). Clean path: exit 0, no nudge.

test('does not fire: status asked, assistant reports the check', async () => {
  const result = await run(
    'check status',
    'The build is at step 4 of 7 and looks healthy.',
  )
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

// PASS-THROUGH — out-of-scope user turn: no status-request shape, so even a
// decline phrase in the assistant turn must be ignored.

test('pass-through: no status request → decline phrase ignored', async () => {
  const result = await run(
    'please refactor the parser module',
    "Too soon to say, I'll wait a bit.",
  )
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

// PASS-THROUGH — decline phrase is only inside a code fence, which the hook
// strips before matching, so it must not fire.

test('pass-through: decline phrase only inside a code fence', async () => {
  const result = await run(
    'check status',
    'Here is the message string:\n```\ntoo soon since last check\n```\nThe build is green.',
  )
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

// EDGE — status asked but there is no assistant turn at all; the hook returns
// early (no last assistant text) without nudging.

test('does not fire: status asked but transcript has no assistant turn', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'answer-status-test-'))
  const file = path.join(dir, 'session.jsonl')
  writeFileSync(file, JSON.stringify({ role: 'user', content: 'status?' }))
  const result = await runHook({ transcript_path: file })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

// EDGE — missing transcript_path: most-recent user text is empty, early return.

test('fail-open: no transcript_path → exit 0, no nudge', async () => {
  const result = await runHook({})
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

// MALFORMED — garbage stdin must not crash; JSON.parse fails → fail-open.

test('fail-open: garbage stdin → exit 0, no crash', async () => {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  void child.catch(() => undefined)
  child.stdin!.end('not json at all {{{')
  let stderr = ''
  child.process.stderr!.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  const result = await new Promise<Result>(resolve => {
    child.process.on('exit', code => {
      resolve({ code: code ?? 0, stderr })
    })
  })
  assert.strictEqual(result.code, 0)
  assert.doesNotMatch(result.stderr, NUDGE)
})

// MALFORMED — empty stdin: JSON.parse('') throws → fail-open.

test('fail-open: empty stdin → exit 0, no nudge', async () => {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  void child.catch(() => undefined)
  child.stdin!.end('')
  let stderr = ''
  child.process.stderr!.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  const result = await new Promise<Result>(resolve => {
    child.process.on('exit', code => {
      resolve({ code: code ?? 0, stderr })
    })
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})
