// node --test specs for the no-env-kill-switch-guard hook.

import test from 'node:test'
import assert from 'node:assert/strict'
// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function makeTranscript(userText: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'env-kill-guard-'))
  const file = path.join(dir, 'session.jsonl')
  writeFileSync(file, JSON.stringify({ role: 'user', content: userText }))
  return file
}

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

type Result = { code: number; stderr: string }

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

// A hook index path that is NOT this guard's own dir (so the own-test exempt
// doesn't fire).
const HOOK_FILE =
  '/Users/x/projects/socket-wheelhouse/template/.claude/hooks/fleet/foo-reminder/index.mts'

test('non-Edit/Write tool calls pass through', async () => {
  const result = await runHook({
    tool_input: { command: 'ls' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
})

test('blocks disabledEnvVar config field', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: HOOK_FILE,
      content:
        "await runStopReminder({\n  name: 'foo-reminder',\n  disabledEnvVar: 'SOCKET_FOO_DISABLED',\n  patterns: [],\n})\n",
    },
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /no-env-kill-switch-guard/)
})

test('blocks process.env[...DISABLED] bracket read', async () => {
  const result = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: HOOK_FILE,
      new_string: "if (process.env['SOCKET_FOO_DISABLED']) {\n  process.exit(0)\n}\n",
    },
  })
  assert.strictEqual(result.code, 2)
})

test('blocks process.env.X_DISABLED dot read', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: HOOK_FILE,
      content: 'if (process.env.SOCKET_FOO_DISABLED) return\n',
    },
  })
  assert.strictEqual(result.code, 2)
})

test('allows a hook with no kill switch', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: HOOK_FILE,
      content:
        "await runStopReminder({\n  name: 'foo-reminder',\n  patterns: [],\n})\n",
    },
  })
  assert.strictEqual(result.code, 0)
})

test('allows non-hook files', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/Users/x/projects/foo/src/config.mts',
      content: "if (process.env['SOCKET_FOO_DISABLED']) return\n",
    },
  })
  assert.strictEqual(result.code, 0)
})

test('allows the documented ALLOW_UNSIGNED break-glass (not a *_DISABLED)', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: HOOK_FILE,
      content: "if (process.env['SOCKET_PRE_COMMIT_ALLOW_UNSIGNED']) skip()\n",
    },
  })
  assert.strictEqual(result.code, 0)
})

test('bypass phrase allows the kill switch', async () => {
  const transcript = makeTranscript('Allow env-kill-switch bypass')
  const result = await runHook({
    tool_name: 'Write',
    transcript_path: transcript,
    tool_input: {
      file_path: HOOK_FILE,
      content: "  disabledEnvVar: 'SOCKET_FOO_DISABLED',\n",
    },
  })
  assert.strictEqual(result.code, 0)
})
