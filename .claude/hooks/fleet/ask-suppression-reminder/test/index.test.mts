// node --test specs for the ask-suppression-reminder hook.

// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

type Result = { code: number; stderr: string }

function writeTranscript(userTurns: string[]): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ask-suppress-tx-'))
  const transcriptPath = path.join(dir, 'session.jsonl')
  const lines = userTurns.map(t =>
    JSON.stringify({ type: 'user', message: { content: t } }),
  )
  writeFileSync(transcriptPath, lines.join('\n') + '\n')
  return transcriptPath
}

async function runHook(payload: Record<string, unknown>): Promise<Result> {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  // v6 lib-stable spawn returns an enriched Promise that rejects on
  // non-zero exit; this test reads stderr + exit via manual listeners
  // instead. Swallow the Promise rejection so it doesn't race the
  // listener-based resolve and trigger "async activity after test ended".
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
  assert.ok(String(r.stderr).includes('go-ahead directive'))
})

test('AskUserQuestion with "yes" — reminder fires', async () => {
  const r = await runHook({
    tool_name: 'AskUserQuestion',
    transcript_path: writeTranscript(['yes']),
  })
  assert.strictEqual(r.code, 0)
  assert.ok(String(r.stderr).includes('go-ahead directive'))
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
  assert.ok(String(r.stderr).includes('go-ahead directive'))
})
