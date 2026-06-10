import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK_PATH = path.join(__dirname, '..', 'index.mts')

function makeTranscript(assistantText: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'planreview-'))
  const transcriptPath = path.join(dir, 'session.jsonl')
  writeFileSync(
    transcriptPath,
    JSON.stringify({ role: 'user', content: 'plan this' }) +
      '\n' +
      JSON.stringify({ role: 'assistant', content: assistantText }),
  )
  return transcriptPath
}

function runHook(transcriptPath: string): { stderr: string; exitCode: number } {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify({ transcript_path: transcriptPath }),
  })
  return { stderr: String(result.stderr), exitCode: result.status ?? -1 }
}

test('FLAGS "Here\'s the plan" without numbered list', () => {
  const t = makeTranscript(
    "Here's the plan: I'll touch a few files, fix the bug, run tests. Done.",
  )
  const { stderr, exitCode } = runHook(t)
  assert.equal(exitCode, 0)
  assert.match(stderr, /plan-review-reminder/)
  assert.match(stderr, /numbered list/)
})

test('does NOT fire when plan has numbered list', () => {
  const t = makeTranscript(
    "Here's the plan:\n\n1. Read file foo.ts\n2. Apply Edit\n3. Run pnpm test",
  )
  const { stderr, exitCode } = runHook(t)
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

test('FLAGS fleet-shared mention without second-opinion invite', () => {
  const t = makeTranscript(
    "I'll edit `template/CLAUDE.md` to add a new rule, then update `.claude/hooks/foo/`.",
  )
  const { stderr, exitCode } = runHook(t)
  assert.equal(exitCode, 0)
  assert.match(stderr, /fleet-shared/)
})

test('does NOT fire when fleet-shared edit has second-opinion invite', () => {
  const t = makeTranscript(
    "Here's the plan:\n\n1. Edit `template/CLAUDE.md`\n2. Invite a second-opinion pass before code.",
  )
  const { stderr, exitCode } = runHook(t)
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

test('does NOT fire on plain non-plan prose', () => {
  const t = makeTranscript(
    'I fixed the bug by removing the stale assertion in foo.ts:42.',
  )
  const { stderr, exitCode } = runHook(t)
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

test('FLAGS a name/schema shape spread across the cascade without it being settled', () => {
  const t = makeTranscript(
    "I'll add a new schema field and rename the check, then cascade it across every fleet repo.",
  )
  const { stderr, exitCode } = runHook(t)
  assert.equal(exitCode, 0)
  assert.match(stderr, /name or schema shape/)
})

test('does NOT fire when the final name/shape is settled', () => {
  const t = makeTranscript(
    "I'll rename the check and cascade it fleet-wide; the final name is settled: `paths-are-canonical`.",
  )
  const { stderr, exitCode } = runHook(t)
  assert.equal(exitCode, 0)
  assert.doesNotMatch(stderr, /name or schema shape/)
})

test('does NOT fire when the naming choice is routed to the user', () => {
  const t = makeTranscript(
    "I'll add a new schema field across template/ and every repo, but first AskUserQuestion which name to use.",
  )
  const { stderr, exitCode } = runHook(t)
  assert.equal(exitCode, 0)
  assert.doesNotMatch(stderr, /name or schema shape/)
})

test('does NOT fire on a single-file rename (no cascade / multi-surface)', () => {
  const t = makeTranscript(
    "I'll rename the helper inside foo.mts and update its one caller.",
  )
  const { stderr, exitCode } = runHook(t)
  assert.equal(exitCode, 0)
  assert.doesNotMatch(stderr, /name or schema shape/)
})
