import assert from 'node:assert/strict'
// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn } from '@socketsecurity/lib-stable/spawn'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.resolve(__dirname, '..', 'index.mts')

interface Payload {
  tool_name?: string | undefined
  tool_input?:
    | {
        command?: string | undefined
      }
    | undefined
}

function runHook(payload: Payload): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK], {
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.process.stderr!.on('data', d => {
      stderr += d.toString()
    })
    child.process.on('error', reject)
    child.process.on('exit', code => {
      resolve({ code: code ?? -1, stderr })
    })
    child.stdin!.end(JSON.stringify(payload))
  })
}

test('reminds (exit 0 + stderr) on git commit', async () => {
  const { code, stderr } = await runHook({
    tool_name: 'Bash',
    tool_input: {
      command: 'git commit -m "ship feature"',
    },
  })
  assert.equal(code, 0, `expected exit 0 (reminder, not block); got ${code}`)
  assert.ok(
    stderr.toLowerCase().includes('private') ||
      stderr.toLowerCase().includes('internal') ||
      stderr.toLowerCase().includes('reminder'),
    `expected reminder text in stderr; got: ${stderr}`,
  )
})

test('reminds on gh pr create', async () => {
  const { code, stderr } = await runHook({
    tool_name: 'Bash',
    tool_input: {
      command: 'gh pr create --title "x" --body "y"',
    },
  })
  assert.equal(code, 0)
  assert.ok(stderr.length > 0, `expected reminder text; got empty stderr`)
})

test('stays silent on non-public-surface commands', async () => {
  const { code, stderr } = await runHook({
    tool_name: 'Bash',
    tool_input: {
      command: 'ls -la',
    },
  })
  assert.equal(code, 0)
  assert.equal(stderr.length, 0, `expected no reminder; got: ${stderr}`)
})

test('stays silent on non-Bash tool', async () => {
  const { code, stderr } = await runHook({
    tool_name: 'Edit',
    tool_input: { command: 'git commit' },
  })
  assert.equal(code, 0)
  assert.equal(stderr.length, 0)
})

test('fails open on malformed stdin', async () => {
  const child = spawn(process.execPath, [HOOK], {
    stdio: ['pipe', 'ignore', 'pipe'],
  })
  child.stdin!.end('not json at all {{{')
  const code = await new Promise<number>(resolve => {
    child.process.on('exit', c => resolve(c ?? -1))
  })
  assert.equal(code, 0, 'malformed stdin must NOT block the tool call')
})
