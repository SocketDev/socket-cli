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

function makeTranscript(assistantText: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'drift-'))
  const transcriptPath = path.join(dir, 'session.jsonl')
  writeFileSync(
    transcriptPath,
    JSON.stringify({ role: 'user', content: 'bump it' }) +
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

test('FLAGS edited external-tools.json without cascade mention', () => {
  const t = makeTranscript('Updated external-tools.json to bump zizmor.')
  const { stderr, exitCode } = runHook(t)
  assert.equal(exitCode, 0)
  assert.match(stderr, /drift-check-reminder/)
  assert.match(stderr, /external-tools\.json/)
})

test('FLAGS edited template/CLAUDE.md without cascade mention', () => {
  const t = makeTranscript('Added a new rule to template/CLAUDE.md.')
  const { stderr, exitCode } = runHook(t)
  assert.equal(exitCode, 0)
  assert.match(stderr, /template\/CLAUDE\.md/)
})

test('does NOT fire when cascade is mentioned', () => {
  const t = makeTranscript(
    'Updated external-tools.json. Cascade to other fleet repos will follow.',
  )
  const { stderr, exitCode } = runHook(t)
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

test('does NOT fire when "sync" / "fleet" appears', () => {
  const t = makeTranscript('Bumped external-tools.json — sync to fleet next.')
  const { stderr, exitCode } = runHook(t)
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

test('does NOT fire when surface is mentioned in passing (no edit verb)', () => {
  const t = makeTranscript('See external-tools.json for the current SHA pins.')
  const { stderr, exitCode } = runHook(t)
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

test('FLAGS lockstep.json edit', () => {
  const t = makeTranscript('Modified lockstep.json to add a new row.')
  const { stderr, exitCode } = runHook(t)
  assert.equal(exitCode, 0)
  assert.match(stderr, /lockstep\.json/)
})

test('FLAGS .gitmodules edit', () => {
  const t = makeTranscript('Added a submodule entry to .gitmodules.')
  const { stderr, exitCode } = runHook(t)
  assert.equal(exitCode, 0)
  assert.match(stderr, /gitmodules/)
})

test('does NOT fire on non-drift edits', () => {
  const t = makeTranscript('Updated src/foo.ts to fix the off-by-one bug.')
  const { stderr, exitCode } = runHook(t)
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

test('disabled env var short-circuits', () => {
  const t = makeTranscript('Bumped external-tools.json.')
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify({ transcript_path: t }),
    encoding: 'utf8',
    env: { ...process.env, SOCKET_DRIFT_CHECK_REMINDER_DISABLED: '1' },
  })
  assert.equal(result.status, 0)
  assert.equal(result.stderr, '')
})
