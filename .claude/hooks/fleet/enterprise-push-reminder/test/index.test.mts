// node --test specs for the enterprise-push-reminder hook.

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

interface Result {
  code: number
  stderr: string
}

async function runHook(payload: Record<string, unknown>): Promise<Result> {
  return new Promise(resolve => {
    // lib spawn() returns a Promise enriched with `.process` (the raw
    // ChildProcess) + `.stdin`; stream stderr / exit off `.process`.
    const childPromise = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
    let stderr = ''
    childPromise.process.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    childPromise.process.on('exit', code => {
      resolve({ code: code ?? 0, stderr })
    })
    childPromise.stdin?.end(JSON.stringify(payload))
  })
}

const ENTERPRISE_ERROR_OUTPUT = [
  'remote: error: GH013: Repository rule violations found for refs/heads/main.',
  'remote: Review all repository rules at https://github.com/.../rules?ref=refs%2Fheads%2Fmain',
  'remote: ',
  "remote: - Required workflow 'Audit GHA Workflows, Audit GHA Workflows' is not satisfied",
  'remote: ',
  'remote: - Changes must be made through a pull request.',
  'To github.com:SocketDev/socket-btm.git',
  ' ! [remote rejected]   main -> main (push declined due to repository rule violations)',
  'error: failed to push some refs to ...',
].join('\n')

test('non-Bash tool passes silently', async () => {
  const r = await runHook({
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: '/tmp/foo.ts' },
    tool_response: 'whatever',
  })
  assert.equal(r.code, 0)
  assert.equal(r.stderr, '')
})

test('Bash non-git-push command passes silently', async () => {
  const r = await runHook({
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'ls -la' },
    tool_response: ENTERPRISE_ERROR_OUTPUT,
  })
  assert.equal(r.code, 0)
  assert.equal(r.stderr, '')
})

test('git push WITHOUT enterprise error passes silently', async () => {
  const r = await runHook({
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'git push origin main' },
    tool_response: 'Everything up-to-date',
  })
  assert.equal(r.code, 0)
  assert.equal(r.stderr, '')
})

test('git push WITH enterprise error fires reminder', async () => {
  const r = await runHook({
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'git push origin main' },
    tool_response: ENTERPRISE_ERROR_OUTPUT,
  })
  assert.equal(r.code, 0)
  assert.match(r.stderr, /enterprise-push-reminder/)
  assert.match(r.stderr, /temporarily-doesnt-touch-customers/)
  assert.match(r.stderr, /"true"/)
})

test('git push WITH --no-verify + enterprise error still fires', async () => {
  const r = await runHook({
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'git push --no-verify origin main' },
    tool_response: ENTERPRISE_ERROR_OUTPUT,
  })
  assert.equal(r.code, 0)
  assert.match(r.stderr, /enterprise-push-reminder/)
})

test('tool_response shaped as object with stderr field is read', async () => {
  const r = await runHook({
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'git push origin main' },
    tool_response: {
      stdout: '',
      stderr: ENTERPRISE_ERROR_OUTPUT,
      interrupted: false,
    },
  })
  assert.equal(r.code, 0)
  assert.match(r.stderr, /enterprise-push-reminder/)
})

test('partial error pattern (one line only) does NOT fire', async () => {
  // Only "Repository rule violations" — missing "must be made through a PR"
  const r = await runHook({
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'git push origin main' },
    tool_response: 'remote: error: Repository rule violations found',
  })
  assert.equal(r.code, 0)
  assert.equal(r.stderr, '')
})

test('non-PostToolUse event passes silently', async () => {
  const r = await runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'git push origin main' },
    tool_response: ENTERPRISE_ERROR_OUTPUT,
  })
  assert.equal(r.code, 0)
  assert.equal(r.stderr, '')
})

test('malformed JSON input passes silently (fail-open)', async () => {
  const childPromise = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  let stderr = ''
  childPromise.process.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })
  childPromise.stdin?.end('not valid json')
  const code: number = await new Promise(resolve => {
    childPromise.process.on('exit', c => resolve(c ?? 0))
  })
  assert.equal(code, 0)
  assert.equal(stderr, '')
})

test('empty stdin passes silently', async () => {
  const childPromise = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  let stderr = ''
  childPromise.process.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })
  childPromise.stdin?.end('')
  const code: number = await new Promise(resolve => {
    childPromise.process.on('exit', c => resolve(c ?? 0))
  })
  assert.equal(code, 0)
  assert.equal(stderr, '')
})
