import assert from 'node:assert/strict'
// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn } from '@socketsecurity/lib-stable/spawn/spawn'
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

test('reminds on git commit (exit 0 + stderr)', async () => {
  const { code, stderr } = await runHook({
    tool_name: 'Bash',
    tool_input: {
      command: 'git commit -m "feat: x"',
    },
  })
  assert.equal(code, 0, `expected reminder, not block; got exit ${code}`)
  assert.ok(stderr.length > 0, 'expected reminder text on stderr')
})

test('reminds on gh release create', async () => {
  const { code, stderr } = await runHook({
    tool_name: 'Bash',
    tool_input: {
      command: 'gh release create v1.0.0 --notes "release"',
    },
  })
  assert.equal(code, 0)
  assert.ok(stderr.length > 0)
})

test('stays silent on non-public-surface commands', async () => {
  const { code, stderr } = await runHook({
    tool_name: 'Bash',
    tool_input: {
      command: 'git status',
    },
  })
  assert.equal(code, 0)
  assert.equal(stderr.length, 0)
})

test('stays silent on non-Bash tool', async () => {
  const { code, stderr } = await runHook({
    tool_name: 'Read',
    tool_input: {},
  })
  assert.equal(code, 0)
  assert.equal(stderr.length, 0)
})

test('fails open on malformed stdin', async () => {
  const child = spawn(process.execPath, [HOOK], {
    stdio: ['pipe', 'ignore', 'pipe'],
  })
  child.stdin!.end('}}}invalid')
  const code = await new Promise<number>(resolve => {
    child.process.on('exit', c => resolve(c ?? -1))
  })
  assert.equal(code, 0)
})
