// node --test specs for the prefer-rebase-over-revert-guard hook.
//
// The hook probes `git` at runtime to decide pushed-ness — these
// tests verify the surface behavior (always exit 0, stderr matches
// on the should-fire cases) rather than the upstream-detection
// internals. The git probe is invoked in whatever cwd the test
// runs in; in this test suite that's the wheelhouse repo, which has
// an upstream, so we exercise both the "skip silently" and "would
// fire if the SHA were unpushed" paths via input shape.

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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

test('non-Bash tool calls pass through silently', async () => {
  const result = await runHook({
    tool_input: { file_path: 'foo.ts', new_string: 'x' },
    tool_name: 'Edit',
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('non-revert Bash commands pass through silently', async () => {
  const result = await runHook({
    tool_input: { command: 'git status' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('commit message bodies mentioning git revert are skipped (quote-aware)', async () => {
  const result = await runHook({
    tool_input: {
      command: `git commit -m "reminder: use git revert later if needed"`,
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('git revert with --no-commit is skipped (advanced workflow)', async () => {
  const result = await runHook({
    tool_input: { command: 'git revert --no-commit HEAD' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('git revert with --no-edit is skipped (advanced workflow)', async () => {
  const result = await runHook({
    tool_input: { command: 'git revert --no-edit abc1234' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('git revert against a bogus ref exits 0 with no stderr (defensive)', async () => {
  // `git rev-parse` will fail on the bogus ref; the hook bails to
  // exit 0 + empty stderr rather than firing a false positive.
  const result = await runHook({
    tool_input: { command: 'git revert this-ref-does-not-exist-anywhere' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('always exits 0 — reminder hook never blocks', async () => {
  // Hook is non-blocking by design. Verify on a shape that WOULD
  // fire the reminder if the SHA were locally-unpushed: HEAD is
  // always pushed on a clean checkout (no local commits), so this
  // should silently skip. Either way, exit 0.
  const result = await runHook({
    tool_input: { command: 'git revert HEAD' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
})
