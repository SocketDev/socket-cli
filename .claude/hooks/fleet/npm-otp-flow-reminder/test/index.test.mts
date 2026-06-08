// node --test specs for the npm-otp-flow-reminder hook.
//
// Spawns the hook as a subprocess, pipes a Bash PreToolUse payload on
// stdin, captures stderr + exit code. The hook never blocks (always
// exit 0); the assertion is on whether the reminder text is emitted.

// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

type Result = { code: number; stderr: string }

async function runHook(command: string): Promise<Result> {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  void child.catch(() => undefined)
  child.stdin!.end(
    JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
  )
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

const REMINDER = /npm-otp-flow-reminder/

test('npm deprecate without --otp emits the reminder', async () => {
  const r = await runHook(
    'npm deprecate socket-mcp "Renamed to @socketsecurity/mcp"',
  )
  assert.strictEqual(r.code, 0)
  assert.match(r.stderr, REMINDER)
  assert.match(r.stderr, /real terminal/i)
})

test('npm publish without --otp emits the reminder', async () => {
  const r = await runHook('npm publish --access public --provenance')
  assert.strictEqual(r.code, 0)
  assert.match(r.stderr, REMINDER)
})

test('npm deprecate WITH --otp= is silent (caller chose fallback)', async () => {
  const r = await runHook('npm deprecate socket-mcp "msg" --otp=123456')
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.stderr, '')
})

test('npm deprecate with bare --otp flag is silent', async () => {
  const r = await runHook('npm deprecate socket-mcp "msg" --otp 123456')
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.stderr, '')
})

test('npm install (not OTP-gated) is silent', async () => {
  const r = await runHook('npm install')
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.stderr, '')
})

test('npm view (read-only) is silent', async () => {
  const r = await runHook('npm view socket-mcp version')
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.stderr, '')
})

test('non-npm command is silent', async () => {
  const r = await runHook('git push --force-with-lease origin main')
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.stderr, '')
})

test('npm owner add inside a chain still triggers', async () => {
  const r = await runHook('npm whoami && npm owner add bob socket-mcp')
  assert.strictEqual(r.code, 0)
  assert.match(r.stderr, REMINDER)
})

test('npm dist-tag add triggers', async () => {
  const r = await runHook('npm dist-tag add @socketsecurity/mcp@0.0.18 latest')
  assert.strictEqual(r.code, 0)
  assert.match(r.stderr, REMINDER)
})
