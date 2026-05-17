import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.resolve(__dirname, '..', 'index.mts')

interface Payload {
  tool_name?: string
  tool_input?: {
    command?: string
  }
}

function runHook(payload: Payload): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK], {
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', d => {
      stderr += d.toString()
    })
    child.on('error', reject)
    child.on('exit', code => {
      resolve({ code: code ?? -1, stderr })
    })
    child.stdin.end(JSON.stringify(payload))
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
  child.stdin.end('not json at all {{{')
  const code = await new Promise<number>(resolve => {
    child.on('exit', c => resolve(c ?? -1))
  })
  assert.equal(code, 0, 'malformed stdin must NOT block the tool call')
})
