// node --test specs for the no-placeholder-commit-subject-guard hook.

// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
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

test('non-Bash tool calls pass through silently', async () => {
  const result = await runHook({
    tool_input: { file_path: 'foo.ts', new_string: 'x' },
    tool_name: 'Edit',
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('a real Conventional Commits subject passes through silently', async () => {
  const result = await runHook({
    tool_input: { command: 'git commit -m "fix(scan): handle empty manifest"' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('git commit -m wip is blocked', async () => {
  const result = await runHook({
    tool_input: { command: 'git commit -m wip' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /no-placeholder-commit-subject-guard.*Blocked/)
})

test('git commit -m "WIP" is blocked case-insensitively', async () => {
  const result = await runHook({
    tool_input: { command: 'git commit -m "WIP"' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /no-placeholder-commit-subject-guard.*Blocked/)
})

test('git commit -m "initial commit" is blocked', async () => {
  const result = await runHook({
    tool_input: { command: 'git commit -m "initial commit"' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /placeholder/)
})

test('git commit -m "update." (trailing period) is blocked', async () => {
  const result = await runHook({
    tool_input: { command: 'git commit -m "update."' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
})

test('git commit -m "" (empty subject) is blocked', async () => {
  const result = await runHook({
    tool_input: { command: 'git commit -m ""' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /empty subject/)
})

test('a placeholder subject chained after another command is still blocked', async () => {
  const result = await runHook({
    tool_input: { command: 'cd /x && git commit -m test' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
})

test('bare git commit (no inline -m) is skipped', async () => {
  const result = await runHook({
    tool_input: { command: 'git commit' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('git commit -F file (no inline subject) is skipped', async () => {
  const result = await runHook({
    tool_input: { command: 'git commit -F /tmp/msg.txt' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('non-commit git command is skipped', async () => {
  const result = await runHook({
    tool_input: { command: 'git status' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('bypass phrase in transcript allows a placeholder subject', async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const transcriptPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'placeholder-bypass-')),
    'transcript.jsonl',
  )
  fs.writeFileSync(
    transcriptPath,
    JSON.stringify({
      message: { content: 'Allow placeholder-subject bypass', role: 'user' },
      type: 'user',
    }) + '\n',
  )
  const result = await runHook({
    tool_input: { command: 'git commit -m wip' },
    tool_name: 'Bash',
    transcript_path: transcriptPath,
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})
