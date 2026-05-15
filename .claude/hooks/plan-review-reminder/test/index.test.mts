import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK_PATH = path.join(__dirname, '..', 'index.mts')

function makeTranscript(assistantText: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'planreview-'))
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
    encoding: 'utf8',
  })
  return { stderr: result.stderr, exitCode: result.status ?? -1 }
}

test('FLAGS "Here\'s the plan" without numbered list', () => {
  const t = makeTranscript(
    'Here\'s the plan: I\'ll touch a few files, fix the bug, run tests. Done.',
  )
  const { stderr, exitCode } = runHook(t)
  assert.equal(exitCode, 0)
  assert.match(stderr, /plan-review-reminder/)
  assert.match(stderr, /numbered list/)
})

test('does NOT fire when plan has numbered list', () => {
  const t = makeTranscript(
    'Here\'s the plan:\n\n1. Read file foo.ts\n2. Apply Edit\n3. Run pnpm test',
  )
  const { stderr, exitCode } = runHook(t)
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

test('FLAGS fleet-shared mention without second-opinion invite', () => {
  const t = makeTranscript(
    'I\'ll edit `template/CLAUDE.md` to add a new rule, then update `.claude/hooks/foo/`.',
  )
  const { stderr, exitCode } = runHook(t)
  assert.equal(exitCode, 0)
  assert.match(stderr, /fleet-shared/)
})

test('does NOT fire when fleet-shared edit has second-opinion invite', () => {
  const t = makeTranscript(
    'Here\'s the plan:\n\n1. Edit `template/CLAUDE.md`\n2. Invite a second-opinion pass before code.',
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

test('disabled env var short-circuits', () => {
  const t = makeTranscript('Here\'s the plan: do stuff.')
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify({ transcript_path: t }),
    encoding: 'utf8',
    env: { ...process.env, SOCKET_PLAN_REVIEW_REMINDER_DISABLED: '1' },
  })
  assert.equal(result.status, 0)
  assert.equal(result.stderr, '')
})
