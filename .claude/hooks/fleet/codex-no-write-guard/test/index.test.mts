// node --test specs for the codex-no-write-guard hook.

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

test('non-codex Bash passes', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'ls -la' },
  })
  assert.strictEqual(r.code, 0)
})

test('command mentioning the guard name (codex-no-write-guard) is NOT a codex invocation', async () => {
  // Regression: the old `codex\b` regex matched `codex-no-write-guard` and
  // the word "write" in it → false block. The parser sees the binary is
  // `for`/`ls`/`grep`, not `codex`.
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: {
      command:
        'grep -n "write" template/.claude/hooks/fleet/codex-no-write-guard/index.mts',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('quoted "codex --write" inside an echo is NOT a codex invocation', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'echo "run codex --write to apply"' },
  })
  assert.strictEqual(r.code, 0)
})

test('real codex --write in a chain is still blocked', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'cd /x && codex --write "do it"' },
  })
  assert.strictEqual(r.code, 2)
})

test('codex with --write blocked', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'codex --write "do something"' },
  })
  assert.strictEqual(r.code, 2)
  assert.ok(String(r.stderr).includes('--write / -w flag'))
})

test('codex -w blocked', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'codex -w "patch this"' },
  })
  assert.strictEqual(r.code, 2)
})

test('codex with "implement" verb blocked', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'codex "implement the bloom filter"' },
  })
  assert.strictEqual(r.code, 2)
  assert.ok(String(r.stderr).includes('implement'))
})

test('codex with "diagnose" passes', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'codex "diagnose this performance regression"' },
  })
  assert.strictEqual(r.code, 0)
})

test('codex with "explain" passes', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'codex "explain what this does"' },
  })
  assert.strictEqual(r.code, 0)
})

test('Agent codex:codex-rescue with implementation intent blocked', async () => {
  const r = await runHook({
    tool_name: 'Agent',
    tool_input: {
      subagent_type: 'codex:codex-rescue',
      prompt: 'implement the SIMD whitespace scanner',
    },
  })
  assert.strictEqual(r.code, 2)
})

test('Agent codex:codex-rescue with diagnosis passes', async () => {
  const r = await runHook({
    tool_name: 'Agent',
    tool_input: {
      subagent_type: 'codex:codex-rescue',
      prompt: 'diagnose why this benchmark regressed',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('Agent for non-codex subagent passes', async () => {
  const r = await runHook({
    tool_name: 'Agent',
    tool_input: {
      subagent_type: 'general-purpose',
      prompt: 'implement the bloom filter',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('bypass phrase passes', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'codex-guard-tx-'))
  const transcriptPath = path.join(dir, 'session.jsonl')
  writeFileSync(
    transcriptPath,
    JSON.stringify({
      type: 'user',
      message: { content: 'Allow codex-write bypass' },
    }) + '\n',
  )
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'codex --write "fix this"' },
    transcript_path: transcriptPath,
  })
  assert.strictEqual(r.code, 0)
})
