import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK_PATH = path.join(__dirname, '..', 'index.mts')

// Build a transcript whose most-recent assistant event uses `model`, plus an
// optional user line (for bypass-phrase tests).
function makeTranscript(model: string, userText?: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tokenspend-'))
  const p = path.join(dir, 'session.jsonl')
  const lines = []
  if (userText) {
    lines.push(JSON.stringify({ role: 'user', content: userText }))
  }
  lines.push(JSON.stringify({ type: 'assistant', model, content: [] }))
  writeFileSync(p, lines.join('\n'))
  return p
}

function runHook(
  command: string,
  transcriptPath: string,
  effort: string,
  extraEnv: Record<string, string> = {},
): { stderr: string; exitCode: number } {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command },
      transcript_path: transcriptPath,
    }),
    env: { ...process.env, CLAUDE_EFFORT: effort, ...extraEnv },
  })
  return { stderr: String(result.stderr), exitCode: result.status ?? -1 }
}

const CASCADE = 'pnpm run sync --target . --fix'

test('REMINDS on mechanical command + premium model (opus)', () => {
  const t = makeTranscript('claude-opus-4-8')
  const { stderr, exitCode } = runHook(CASCADE, t, 'low')
  assert.equal(exitCode, 2)
  assert.match(stderr, /token-spend-guard/)
  assert.match(stderr, /premium/)
  assert.match(stderr, /opus/)
})

test('REMINDS on mechanical command + premium effort (high)', () => {
  const t = makeTranscript('claude-sonnet-4-6')
  const { stderr, exitCode } = runHook(CASCADE, t, 'high')
  assert.equal(exitCode, 2)
  assert.match(stderr, /effort/)
})

test('ALLOWS mechanical command on cheap model + low effort', () => {
  const t = makeTranscript('claude-sonnet-4-6')
  const { exitCode } = runHook(CASCADE, t, 'low')
  assert.equal(exitCode, 0)
})

test('ALLOWS a non-mechanical command even on premium model + high effort', () => {
  const t = makeTranscript('claude-opus-4-8')
  const { exitCode } = runHook('git status', t, 'high')
  assert.equal(exitCode, 0)
})

test('model bypass silences the model flag (effort low → fully clears)', () => {
  const t = makeTranscript('claude-opus-4-8', 'Allow model bypass')
  const { exitCode } = runHook(CASCADE, t, 'low')
  assert.equal(exitCode, 0)
})

test('effort bypass silences the effort flag (cheap model → fully clears)', () => {
  const t = makeTranscript('claude-sonnet-4-6', 'Allow effort bypass')
  const { exitCode } = runHook(CASCADE, t, 'max')
  assert.equal(exitCode, 0)
})

test('one bypass does NOT silence the other dimension', () => {
  // opus + high, only model bypassed → effort still flags.
  const t = makeTranscript('claude-opus-4-8', 'Allow model bypass')
  const { stderr, exitCode } = runHook(CASCADE, t, 'high')
  assert.equal(exitCode, 2)
  assert.match(stderr, /effort/)
  assert.doesNotMatch(stderr, /Switch: \/model/)
})

test('cascade commit subject triggers the guard', () => {
  const t = makeTranscript('claude-opus-4-8')
  const { exitCode } = runHook(
    'git commit -m "chore(wheelhouse): cascade template@abc123"',
    t,
    'low',
  )
  assert.equal(exitCode, 2)
})

test('disabled env var short-circuits', () => {
  const t = makeTranscript('claude-opus-4-8')
  const { exitCode } = runHook(CASCADE, t, 'high', {
    SOCKET_TOKEN_SPEND_GUARD_DISABLED: '1',
  })
  assert.equal(exitCode, 0)
})

test('IGNORES non-Bash tools', () => {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify({
      tool_name: 'Write',
      tool_input: { command: CASCADE },
    }),
    env: { ...process.env, CLAUDE_EFFORT: 'high' },
  })
  assert.equal(result.status, 0)
})
