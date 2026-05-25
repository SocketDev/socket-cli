// node --test specs for the claude-md-size-guard hook.

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

async function runHook(
  payload: Record<string, unknown>,
  envOverride?: Record<string, string>,
): Promise<Result> {
  const child = spawn(process.execPath, [HOOK], {
    stdio: 'pipe',
    env: { ...process.env, ...envOverride },
  })
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

test('non-CLAUDE.md targets are ignored', async () => {
  const result = await runHook({
    tool_input: { content: 'x'.repeat(100_000), file_path: 'README.md' },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('Write of small file is allowed', async () => {
  const result = await runHook({
    tool_input: { content: 'x'.repeat(1_000), file_path: 'CLAUDE.md' },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('Write of file at exactly 40KB is allowed', async () => {
  const result = await runHook({
    tool_input: { content: 'x'.repeat(40 * 1024), file_path: 'CLAUDE.md' },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('Write of file over 40KB is blocked', async () => {
  const result = await runHook({
    tool_input: { content: 'x'.repeat(45 * 1024), file_path: 'CLAUDE.md' },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /claude-md-size-guard/)
  assert.match(result.stderr, /too large/)
  assert.match(result.stderr, /docs\/claude\.md\/fleet\//)
})

test('cap override via env var', async () => {
  const result = await runHook(
    {
      tool_input: { content: 'x'.repeat(2_000), file_path: 'CLAUDE.md' },
      tool_name: 'Write',
    },
    { CLAUDE_MD_BYTES: '1024' },
  )
  assert.strictEqual(result.code, 2)
})

test('legacy CLAUDE_MD_FLEET_BLOCK_BYTES env still works as fallback', async () => {
  const result = await runHook(
    {
      tool_input: { content: 'x'.repeat(2_000), file_path: 'CLAUDE.md' },
      tool_name: 'Write',
    },
    { CLAUDE_MD_FLEET_BLOCK_BYTES: '1024' },
  )
  assert.strictEqual(result.code, 2)
})

test('Edit splice that grows file over cap is blocked', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'claude-md-size-guard-'))
  const file = path.join(dir, 'CLAUDE.md')
  writeFileSync(file, 'base\n')
  const result = await runHook({
    tool_input: {
      file_path: file,
      new_string: 'y'.repeat(45 * 1024),
      old_string: 'base\n',
    },
    tool_name: 'Edit',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /too large/)
})

test('Edit splice that keeps file under cap is allowed', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'claude-md-size-guard-'))
  const file = path.join(dir, 'CLAUDE.md')
  writeFileSync(file, 'base\n')
  const result = await runHook({
    tool_input: {
      file_path: file,
      new_string: 'z'.repeat(2_000),
      old_string: 'base\n',
    },
    tool_name: 'Edit',
  })
  assert.strictEqual(result.code, 0)
})
