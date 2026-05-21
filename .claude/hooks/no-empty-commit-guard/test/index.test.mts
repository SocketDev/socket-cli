// node --test specs for the no-empty-commit-guard hook.

// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn } from '@socketsecurity/lib-stable/spawn/spawn'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

type Result = { code: number; stderr: string }

async function runHook(payload: Record<string, unknown>): Promise<Result> {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
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

test('non-Bash tool calls pass through silently', async () => {
  const result = await runHook({
    tool_input: { file_path: 'foo.ts', new_string: 'x' },
    tool_name: 'Edit',
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('plain git commit passes through silently', async () => {
  const result = await runHook({
    tool_input: { command: 'git commit -m "real change"' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('git commit --allow-empty is blocked', async () => {
  const result = await runHook({
    tool_input: {
      command: 'git commit --allow-empty -m "anchor v1.0.0 tag"',
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /no-empty-commit-guard.*Blocked/)
})

test('git commit --allow-empty-message is blocked', async () => {
  const result = await runHook({
    tool_input: { command: 'git commit --allow-empty-message -m ""' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /no-empty-commit-guard.*Blocked/)
})

test('git cherry-pick --allow-empty is blocked', async () => {
  const result = await runHook({
    tool_input: { command: 'git cherry-pick --allow-empty abc1234' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /no-empty-commit-guard.*Blocked/)
})

test('git cherry-pick --keep-redundant-commits is blocked', async () => {
  const result = await runHook({
    tool_input: {
      command: 'git cherry-pick --keep-redundant-commits abc1234',
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /no-empty-commit-guard.*Blocked/)
})

test('plain git cherry-pick passes through silently', async () => {
  const result = await runHook({
    tool_input: { command: 'git cherry-pick abc1234' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('commit message bodies mentioning --allow-empty are skipped (quote-aware)', async () => {
  const result = await runHook({
    tool_input: {
      command: `git commit -m "docs: forbid git commit --allow-empty in fleet"`,
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})
