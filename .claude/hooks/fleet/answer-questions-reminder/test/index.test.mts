// node --test specs for the answer-questions-reminder hook.
//
// Stop hook (no tool_name/tool_input — it reads transcript_path).
// It's a -reminder: it never blocks (always exits 0); when it fires it
// writes a nudge to stderr. The hook fires when the MOST RECENT user
// turn is a passing question (contains `?` or an interrogative lead) AND
// it is not a redirect/pivot AND the MOST RECENT assistant turn contains
// a deflection phrase. It has NO `Allow … bypass` phrase — the only
// "skip" path is the PIVOT_PATTERNS exception (a redirect, where the
// assistant is meant to pivot, so the reminder stays quiet).

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

// Write a two-turn JSONL transcript: one user turn then one assistant
// turn. readUserText(path, 1) picks the most recent user turn and
// readLastAssistantText picks the most recent assistant turn, so a
// single user/assistant pair covers both reads. Natural order is kept
// for readability.
function makeTranscript(userText: string, assistantText: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'answer-questions-reminder-'))
  const file = path.join(dir, 'session.jsonl')
  const lines = [
    JSON.stringify({ role: 'user', content: userText }),
    JSON.stringify({ role: 'assistant', content: assistantText }),
  ]
  writeFileSync(file, lines.join('\n'))
  return file
}

function makeUserOnlyTranscript(userText: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'answer-questions-reminder-'))
  const file = path.join(dir, 'session.jsonl')
  writeFileSync(file, JSON.stringify({ role: 'user', content: userText }))
  return file
}

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

type Result = { code: number; stderr: string }

// Spawn the hook, write `stdinRaw` bytes verbatim to stdin, collect
// stderr, resolve on exit. Pass a string to control the exact stdin
// payload (needed for the malformed-bytes case).
async function runHookRaw(stdinRaw: string): Promise<Result> {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  void child.catch(() => undefined)
  child.stdin!.end(stdinRaw)
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

async function runHook(payload: Record<string, unknown>): Promise<Result> {
  return runHookRaw(JSON.stringify(payload))
}

// ---------------------------------------------------------------------------
// FIRES — user asked a passing question, assistant deflected.
// One case per distinct deflection pattern + one per question shape.
// ---------------------------------------------------------------------------

test('fires: question mark + "right now I\'m" deflection', async () => {
  const transcript = makeTranscript(
    'Should the cache be keyed by repo too?',
    "Right now I'm wiring up the parser, so I'll get to caching after.",
  )
  const result = await runHook({ transcript_path: transcript })
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, /answer-questions-reminder/)
  assert.match(result.stderr, /brushed past/)
})

test('fires: "let me finish" deflection', async () => {
  const transcript = makeTranscript(
    'Is the lockfile soak window 7 days?',
    'Let me finish the refactor before I dig into the soak window.',
  )
  const result = await runHook({ transcript_path: transcript })
  assert.strictEqual(result.code, 0)
  assert.notStrictEqual(result.stderr.trim(), '')
  assert.match(result.stderr, /let me finish \/ let me first/)
})

test('fires: "that\'s a structural fix for later" deflection', async () => {
  const transcript = makeTranscript(
    'What happens if two sessions race the index.lock?',
    "That's a structural fix for later. Continuing the build now.",
  )
  const result = await runHook({ transcript_path: transcript })
  assert.strictEqual(result.code, 0)
  assert.notStrictEqual(result.stderr.trim(), '')
})

test('fires: "for now, I\'m" deflection', async () => {
  const transcript = makeTranscript(
    'Where does the build output land?',
    "For now, I'm focused on the failing test.",
  )
  const result = await runHook({ transcript_path: transcript })
  assert.strictEqual(result.code, 0)
  assert.notStrictEqual(result.stderr.trim(), '')
})

test('fires: "I\'ll come back to that" deflection', async () => {
  const transcript = makeTranscript(
    'Why is the dep pinned to a beta?',
    "Good point. I'll come back to that once the suite is green.",
  )
  const result = await runHook({ transcript_path: transcript })
  assert.strictEqual(result.code, 0)
  assert.notStrictEqual(result.stderr.trim(), '')
})

test('fires: interrogative lead with NO question mark ("can we …")', async () => {
  // No `?` — exercises the interrogative-leading-word branch.
  const transcript = makeTranscript(
    'Can we reuse the existing paths.mts here.',
    'Let me finish the current edit first.',
  )
  const result = await runHook({ transcript_path: transcript })
  assert.strictEqual(result.code, 0)
  assert.notStrictEqual(result.stderr.trim(), '')
})

test('fires: nudge echoes the user question snippet', async () => {
  const transcript = makeTranscript(
    'How should errors be surfaced to the caller?',
    "Right now I'm in the middle of the renderer.",
  )
  const result = await runHook({ transcript_path: transcript })
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, /How should errors be surfaced/)
})

// ---------------------------------------------------------------------------
// DOES NOT FIRE — clean / valid input that should pass quietly.
// ---------------------------------------------------------------------------

test('does not fire: assistant actually answered (no deflection phrase)', async () => {
  const transcript = makeTranscript(
    'Should the cache be keyed by repo too?',
    'Yes — the cache key includes the repo slug, so two repos never collide.',
  )
  const result = await runHook({ transcript_path: transcript })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr.trim(), '')
})

test('does not fire: user turn is not a question', async () => {
  const transcript = makeTranscript(
    'Add a logger import to the top of the file.',
    "Right now I'm wiring up the parser.",
  )
  const result = await runHook({ transcript_path: transcript })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr.trim(), '')
})

// ---------------------------------------------------------------------------
// SKIP / PASS-THROUGH — the PIVOT exception (a redirect, not a passing
// question) and other out-of-scope shapes the hook must ignore.
// ---------------------------------------------------------------------------

test('skips: pivot redirect "stop and …" even with a question + deflection', async () => {
  const transcript = makeTranscript(
    'Stop and answer this — should we bump the version?',
    "Right now I'm wiring up the parser.",
  )
  const result = await runHook({ transcript_path: transcript })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr.trim(), '')
})

test('skips: pivot redirect "switch to …" even with a question + deflection', async () => {
  const transcript = makeTranscript(
    'Switch to the lint fixes — can we land those first?',
    'Let me finish this edit first.',
  )
  const result = await runHook({ transcript_path: transcript })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr.trim(), '')
})

test('skips: imperative redirect "do it now" even with a question shape', async () => {
  const transcript = makeTranscript(
    'Do it now. What about the tests?',
    "Right now I'm in the middle of the renderer.",
  )
  const result = await runHook({ transcript_path: transcript })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr.trim(), '')
})

test('pass-through: no transcript_path at all', async () => {
  const result = await runHook({})
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr.trim(), '')
})

test('pass-through: transcript has no assistant turn', async () => {
  const transcript = makeUserOnlyTranscript('Should we cache the result?')
  const result = await runHook({ transcript_path: transcript })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr.trim(), '')
})

test('pass-through: deflection phrase only inside a code fence is ignored', async () => {
  // stripCodeFences removes fenced blocks before matching, so the
  // deflection phrase inside the fence must NOT count.
  const transcript = makeTranscript(
    'Should the cache be keyed by repo too?',
    'Yes, keyed by repo. Example:\n```\n// let me finish first\n```\nDone.',
  )
  const result = await runHook({ transcript_path: transcript })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr.trim(), '')
})

// ---------------------------------------------------------------------------
// MALFORMED — fail-open: never crash, never block.
// ---------------------------------------------------------------------------

test('malformed: garbage stdin fails open (exit 0, no nudge)', async () => {
  // Raw non-JSON bytes — JSON.parse throws and main() returns early.
  const result = await runHookRaw('not-json-at-all {{{')
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr.trim(), '')
})

test('malformed: empty stdin fails open (exit 0, no nudge)', async () => {
  const result = await runHookRaw('')
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr.trim(), '')
})

test('malformed: transcript_path points at a missing file fails open', async () => {
  const result = await runHook({
    transcript_path: path.join(tmpdir(), 'does-not-exist-xyzzy.jsonl'),
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr.trim(), '')
})
