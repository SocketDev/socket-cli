// node --test specs for the programmatic-claude-lockdown-guard hook.

import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

function makeTranscript(userText: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'lockdown-guard-'))
  const file = path.join(dir, 'session.jsonl')
  writeFileSync(file, JSON.stringify({ role: 'user', content: userText }))
  return file
}

function runHook(
  command: string,
  transcriptPath?: string,
): {
  code: number
  stderr: string
} {
  const payload: Record<string, unknown> = {
    tool_name: 'Bash',
    tool_input: { command },
  }
  if (transcriptPath) {
    payload['transcript_path'] = transcriptPath
  }
  const r = spawnSync('node', [HOOK], { input: JSON.stringify(payload) })
  return { code: r.status ?? -1, stderr: String(r.stderr) }
}

const LOCKED =
  'claude -p "hi" --allowedTools Read --disallowedTools Bash --permission-mode dontAsk'

test('BLOCKS headless claude missing --allowedTools', () => {
  const { code, stderr } = runHook(
    'claude -p "go" --disallowedTools Bash --permission-mode dontAsk',
  )
  assert.equal(code, 2)
  assert.match(stderr, /programmatic-claude-lockdown-guard/)
})

test('BLOCKS headless claude missing --disallowedTools', () => {
  const { code } = runHook(
    'claude --print "go" --allowedTools Read --permission-mode dontAsk',
  )
  assert.equal(code, 2)
})

test('BLOCKS headless claude missing --permission-mode', () => {
  const { code } = runHook(
    'claude -p "go" --allowedTools Read --disallowedTools Bash',
  )
  assert.equal(code, 2)
})

test('BLOCKS --dangerously-skip-permissions', () => {
  const { code } = runHook('claude -p "go" --dangerously-skip-permissions')
  assert.equal(code, 2)
})

test('BLOCKS --permission-mode default', () => {
  const { code } = runHook(
    'claude -p "go" --allowedTools Read --disallowedTools Bash --permission-mode default',
  )
  assert.equal(code, 2)
})

test('BLOCKS --permission-mode bypassPermissions', () => {
  const { code } = runHook(
    'claude -p "go" --allowedTools Read --disallowedTools Bash --permission-mode bypassPermissions',
  )
  assert.equal(code, 2)
})

test('ALLOWS fully locked-down headless claude', () => {
  const { code } = runHook(LOCKED)
  assert.equal(code, 0)
})

test('ALLOWS locked-down claude with kebab + = flag forms', () => {
  const { code } = runHook(
    'claude --print "go" --allowed-tools=Read --disallowed-tools=Bash --permission-mode=acceptEdits',
  )
  assert.equal(code, 0)
})

test('ALLOWS interactive claude (no -p/--print)', () => {
  const { code } = runHook('claude "what is this repo"')
  assert.equal(code, 0)
})

test('BLOCKS codex exec --dangerously-bypass-approvals-and-sandbox', () => {
  const { code, stderr } = runHook(
    'codex exec "do it" --dangerously-bypass-approvals-and-sandbox',
  )
  assert.equal(code, 2)
  assert.match(stderr, /programmatic-claude-lockdown-guard/)
})

test('BLOCKS codex exec --sandbox danger-full-access', () => {
  const { code } = runHook(
    'codex exec "do it" --sandbox danger-full-access -a never',
  )
  assert.equal(code, 2)
})

test('ALLOWS codex exec --sandbox workspace-write -a never', () => {
  const { code } = runHook(
    'codex exec "do it" --sandbox workspace-write -a never',
  )
  assert.equal(code, 0)
})

test('ALLOWS bare codex (no exec)', () => {
  const { code } = runHook('codex login')
  assert.equal(code, 0)
})

test('ALLOWS with bypass phrase', () => {
  const { code } = runHook(
    'claude -p "go"',
    makeTranscript('Allow programmatic-claude-lockdown bypass'),
  )
  assert.equal(code, 0)
})

test('IGNORES non-Bash tool', () => {
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: '/x.ts', content: 'claude -p "go"' },
    }),
  })
  assert.equal(r.status ?? -1, 0)
})

test('fails open on malformed JSON', () => {
  const r = spawnSync('node', [HOOK], { input: 'not-json{' })
  assert.equal(r.status ?? -1, 0)
})
