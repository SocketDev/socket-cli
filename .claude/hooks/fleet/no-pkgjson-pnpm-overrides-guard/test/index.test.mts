// node --test specs for the no-pkgjson-pnpm-overrides-guard hook.

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

function tmpPackageJson(content: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pj-overrides-guard-test-'))
  const p = path.join(dir, 'package.json')
  writeFileSync(p, content)
  return p
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

test('non-Edit/Write tool passes', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'echo hi' },
  })
  assert.strictEqual(r.code, 0)
})

test('Edit to a non-package.json file passes', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pj-overrides-guard-other-'))
  const filePath = path.join(dir, 'pnpm-workspace.yaml')
  writeFileSync(filePath, 'overrides:\n  foo: 1.0.0\n')
  const r = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: filePath,
      old_string: 'foo: 1.0.0',
      new_string: 'foo: 2.0.0',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('Edit that does not touch pnpm.overrides passes', async () => {
  const filePath = tmpPackageJson(
    '{\n  "name": "x",\n  "version": "1.0.0"\n}\n',
  )
  const r = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: filePath,
      old_string: '"1.0.0"',
      new_string: '"1.0.1"',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('Edit removes a pnpm.overrides key — passes', async () => {
  const filePath = tmpPackageJson(
    '{\n  "name": "x",\n  "pnpm": { "overrides": { "a": "1", "b": "2" } }\n}\n',
  )
  const r = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: filePath,
      old_string: '{ "a": "1", "b": "2" }',
      new_string: '{ "a": "1" }',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('Edit adds a new pnpm.overrides key — blocked', async () => {
  const filePath = tmpPackageJson(
    '{\n  "name": "x",\n  "pnpm": { "overrides": { "a": "1" } }\n}\n',
  )
  const r = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: filePath,
      old_string: '{ "a": "1" }',
      new_string: '{ "a": "1", "b": "2" }',
    },
  })
  assert.strictEqual(r.code, 2)
  assert.ok(String(r.stderr).includes('`b`'))
})

test('Write adds a fresh pnpm.overrides — blocked', async () => {
  const filePath = tmpPackageJson('{ "name": "x" }')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: filePath,
      content: '{ "name": "x", "pnpm": { "overrides": { "sketchy": "9" } } }',
    },
  })
  assert.strictEqual(r.code, 2)
  assert.ok(String(r.stderr).includes('sketchy'))
})

test('Edit with bypass phrase in transcript — passes', async () => {
  const filePath = tmpPackageJson('{ "name": "x" }')
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pj-overrides-guard-tx-'))
  const transcriptPath = path.join(dir, 'session.jsonl')
  writeFileSync(
    transcriptPath,
    JSON.stringify({
      type: 'user',
      message: { content: 'Allow package-json-overrides bypass' },
    }) + '\n',
  )
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: filePath,
      content: '{ "name": "x", "pnpm": { "overrides": { "b": "2" } } }',
    },
    transcript_path: transcriptPath,
  })
  assert.strictEqual(r.code, 0)
})
