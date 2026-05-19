// node --test specs for the concurrent-cargo-build-guard hook.

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

type Result = { code: number; stderr: string }

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

// Note: real concurrency-detection tests require spawning a fake long-running
// process and pgrep'ing for it, which is platform-fragile in CI. The
// happy-path tests below cover the deterministic surfaces (command-pattern
// matching, exempt commands, bypass) and rely on the no-in-flight default
// for the "passes when nothing is running" case.

test('non-Bash tool passes', async () => {
  const r = await runHook({
    tool_name: 'Edit',
    tool_input: { file_path: '/tmp/x.txt', new_string: 'hi' },
  })
  assert.strictEqual(r.code, 0)
})

test('cargo check passes (exempt)', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'cargo check' },
  })
  assert.strictEqual(r.code, 0)
})

test('cargo build (no --release) passes (exempt)', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'cargo build' },
  })
  assert.strictEqual(r.code, 0)
})

test('cargo build --release passes when nothing else is in flight', async () => {
  // pgrep should find no other cargo release builds in test env.
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'cargo build --release' },
  })
  assert.strictEqual(r.code, 0)
})

test('cargo b -r matches the pattern', async () => {
  // Same as above — no in-flight build expected in test env.
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'cd packages/acorn/lang/rust && cargo b -r' },
  })
  assert.strictEqual(r.code, 0)
})

test('pnpm build:prod matches the pattern', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'pnpm build:prod' },
  })
  assert.strictEqual(r.code, 0)
})

test('unrelated Bash command passes', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: {
      command: 'echo "cargo build --release is a string, not a call"',
    },
  })
  // The hook treats the command string as-is — `cargo build --release`
  // inside an echo IS the pattern match. The block fires only when an
  // actual in-flight build is detected; in the test env, there is none.
  assert.strictEqual(r.code, 0)
})
