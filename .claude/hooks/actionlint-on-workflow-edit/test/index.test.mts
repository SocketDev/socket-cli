// node --test specs for the actionlint-on-workflow-edit hook.

import { spawn, spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
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

const actionlintInstalled = (() => {
  const r = spawnSync('command', ['-v', 'actionlint'])
  return r.status === 0
})()

test('non-workflow file passes silently', async () => {
  const r = await runHook({
    tool_name: 'Write',
    tool_input: { file_path: '/tmp/foo.txt' },
  })
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.stderr, '')
})

test('non-Edit/Write tool passes silently', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'echo hi' },
  })
  assert.strictEqual(r.code, 0)
})

test('workflow edit always exits 0 (PostToolUse — reporting only)', async () => {
  // We don't need actionlint installed to verify the exit code; the
  // hook short-circuits to 0 on actionlint-not-found.
  const r = await runHook({
    tool_name: 'Edit',
    tool_input: { file_path: '/tmp/some.github/workflows/x.yml' },
  })
  assert.strictEqual(r.code, 0)
})

test('workflow edit with installed actionlint runs the tool (smoke)', async t => {
  if (!actionlintInstalled) {
    t.skip('actionlint not on PATH')
    return
  }
  // Smoke test only — provide a path to a nonexistent file; actionlint
  // will error but the hook itself exits 0. We just check it doesn't
  // crash.
  const r = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: '/this/path/does/not/exist/.github/workflows/x.yml',
    },
  })
  assert.strictEqual(r.code, 0)
})
