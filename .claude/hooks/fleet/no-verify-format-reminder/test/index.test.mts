// node --test specs for the no-verify-format-reminder hook.

import test from 'node:test'
import assert from 'node:assert/strict'
// prefer-async-spawn: streaming-stdio-required — the end-to-end arms spawn the
// hook subprocess and pipe stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// NOTE: do NOT `import` from ../index.mts here — its top-level `withBashGuard`
// runs on import (reading stdin), which stalls the test module's evaluation.
// The hook is exercised purely by spawning it as a subprocess, the same way
// the harness invokes it.

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

interface Result {
  code: number
  stderr: string
}

async function runHook(payload: Record<string, unknown>): Promise<Result> {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
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

// --- end-to-end (spawned hook) — no git/oxfmt needed for the silent paths ---

test('silent: not a git commit/push at all', async () => {
  const { code, stderr } = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'pnpm test' },
  })
  assert.equal(code, 0)
  assert.equal(stderr.trim(), '')
})

test('silent: git commit WITHOUT --no-verify (the gate runs normally)', async () => {
  const { code, stderr } = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'git commit -m "feat: x"' },
  })
  assert.equal(code, 0)
  assert.equal(stderr.trim(), '')
})

test('silent: FLEET_SYNC cascade commit (--no-verify exception)', async () => {
  const { code, stderr } = await runHook({
    tool_name: 'Bash',
    tool_input: {
      command:
        'FLEET_SYNC=1 git commit --no-verify -m "chore(wheelhouse): cascade"',
    },
  })
  assert.equal(code, 0)
  assert.equal(stderr.trim(), '')
})

test('non-Bash tool passes through', async () => {
  const { code } = await runHook({
    tool_name: 'Read',
    tool_input: { file_path: 'foo.ts' },
  })
  assert.equal(code, 0)
})

test('malformed payload fails open', async () => {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  void child.catch(() => undefined)
  child.stdin!.end('not-json')
  const code = await new Promise<number>(resolve => {
    child.process.on('exit', c => resolve(c ?? 0))
  })
  assert.equal(code, 0)
})
