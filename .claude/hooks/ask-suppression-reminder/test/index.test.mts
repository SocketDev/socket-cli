// node --test specs for the ask-suppression-reminder hook.

import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

type Result = { code: number; stderr: string }

function writeTranscript(userTurns: string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ask-suppress-tx-'))
  const transcriptPath = path.join(dir, 'session.jsonl')
  const lines = userTurns.map(t =>
    JSON.stringify({ type: 'user', message: { content: t } }),
  )
  writeFileSync(transcriptPath, lines.join('\n') + '\n')
  return transcriptPath
}

async function runHook(payload: Record<string, unknown>): Promise<Result> {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  child.stdin.end(JSON.stringify(payload))
  let stderr = ''
  child.stderr.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  return new Promise(resolve => {
    child.on('exit', code => {
      resolve({ code: code ?? 0, stderr })
    })
  })
}

test('non-AskUserQuestion passes silently', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'echo hi' },
    transcript_path: writeTranscript(['yes']),
  })
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.stderr, '')
})

test('AskUserQuestion with no recent directive — no reminder', async () => {
  const r = await runHook({
    tool_name: 'AskUserQuestion',
    transcript_path: writeTranscript([
      'Can you investigate the bug?',
      'I think it is in the parser.',
    ]),
  })
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.stderr, '')
})

test('AskUserQuestion with recent "do it" — reminder fires', async () => {
  const r = await runHook({
    tool_name: 'AskUserQuestion',
    transcript_path: writeTranscript(['First find them.', 'do it']),
  })
  assert.strictEqual(r.code, 0)
  assert.ok(r.stderr.includes('go-ahead directive'))
})

test('AskUserQuestion with "yes" — reminder fires', async () => {
  const r = await runHook({
    tool_name: 'AskUserQuestion',
    transcript_path: writeTranscript(['yes']),
  })
  assert.strictEqual(r.code, 0)
  assert.ok(r.stderr.includes('go-ahead directive'))
})

test('AskUserQuestion with "yes" buried in paragraph — no reminder', async () => {
  const r = await runHook({
    tool_name: 'AskUserQuestion',
    transcript_path: writeTranscript([
      'yes, but only after you read the docs and report what you find',
    ]),
  })
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.stderr, '')
})

test('digit-only directive ("1") fires reminder', async () => {
  const r = await runHook({
    tool_name: 'AskUserQuestion',
    transcript_path: writeTranscript(['Pick one of these:', '1']),
  })
  assert.strictEqual(r.code, 0)
  assert.ok(r.stderr.includes('go-ahead directive'))
})

test('disabled via env var', async () => {
  const child = spawn(process.execPath, [HOOK], {
    stdio: 'pipe',
    env: {
      ...process.env,
      SOCKET_ASK_SUPPRESSION_REMINDER_DISABLED: '1',
    },
  })
  child.stdin.end(
    JSON.stringify({
      tool_name: 'AskUserQuestion',
      transcript_path: writeTranscript(['do it']),
    }),
  )
  let stderr = ''
  child.stderr.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  const code = await new Promise<number>(resolve => {
    child.on('exit', c => resolve(c ?? 0))
  })
  assert.strictEqual(code, 0)
  assert.strictEqual(stderr, '')
})
