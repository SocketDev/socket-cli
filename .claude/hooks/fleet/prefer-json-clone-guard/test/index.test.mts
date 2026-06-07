// Tests for prefer-json-clone-guard.

import assert from 'node:assert/strict'
// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(__dirname, '..', 'index.mts')

interface RunResult {
  code: number
  stderr: string
}

function runHook(payload: object): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [HOOK], { stdio: ['pipe', 'pipe', 'pipe'] })
    // v6 lib-stable spawn returns an enriched Promise that rejects on
    // non-zero exit; this test reads stderr + exit via manual listeners
    // instead. Swallow the Promise rejection so it doesn't race the
    // listener-based resolve and trigger "async activity after test ended".
    void child.catch(() => undefined)
    let stderr = ''
    child.process.stderr!.on('data', d => {
      stderr += d.toString()
    })
    child.process.on('error', reject)
    child.process.on('close', code => {
      resolve({ code: code ?? 0, stderr })
    })
    child.stdin!.write(JSON.stringify(payload))
    child.stdin!.end()
  })
}

const BARE_USE = `export function clone(v: unknown) {
  return structuredClone(v)
}
`

const WITH_DISABLE = `export function clone(v: unknown) {
  // oxlint-disable-next-line socket/no-structured-clone-prefer-json -- value contains Date instances; JSON would corrupt.
  return structuredClone(v)
}
`

const WITH_HOOK_ALLOW = `export function clone(v: unknown) {
  return structuredClone(v) // socket-lint: allow structured-clone
}
`

// Member-access call on a user object — `o.structuredClone()` must NOT
// trigger the hook. The hook's regex uses a negative-lookbehind to skip
// `.structuredClone(` shapes.
const MEMBER_CALL = `export function clone(o: any) {
  return o.structuredClone()
}
`

const COMMENT_ONLY = `// docstring mentioning structuredClone(x) but not calling it
export const x = 1
`

describe('prefer-json-clone-guard', () => {
  test('blocks bare structuredClone call', async () => {
    const result = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/example.ts', content: BARE_USE },
    })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /structuredClone/)
    assert.match(result.stderr, /JSON\.parse/)
  })

  test('passes when oxlint-disable-next-line comment is present', async () => {
    const result = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/example.ts', content: WITH_DISABLE },
    })
    assert.equal(result.code, 0, result.stderr)
  })

  test('passes when socket-lint allow marker is present', async () => {
    const result = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/example.ts', content: WITH_HOOK_ALLOW },
    })
    assert.equal(result.code, 0, result.stderr)
  })

  test('ignores member-call user methods named structuredClone', async () => {
    const result = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/example.ts', content: MEMBER_CALL },
    })
    assert.equal(result.code, 0, result.stderr)
  })

  test('ignores comment-only references', async () => {
    const result = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/example.ts', content: COMMENT_ONLY },
    })
    assert.equal(result.code, 0, result.stderr)
  })

  test('ignores non-code files', async () => {
    const result = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/example.md', content: BARE_USE },
    })
    assert.equal(result.code, 0, result.stderr)
  })

  test('ignores .d.ts declaration files', async () => {
    const result = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/example.d.ts', content: BARE_USE },
    })
    assert.equal(result.code, 0, result.stderr)
  })

  test('ignores non-Edit/Write tool calls', async () => {
    const result = await runHook({
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/example.ts', content: BARE_USE },
    })
    assert.equal(result.code, 0, result.stderr)
  })

  test('fails open on malformed payload', async () => {
    const child = spawn('node', [HOOK], { stdio: ['pipe', 'pipe', 'pipe'] })
    let exitCode = 0
    child.stdin!.write('not-json')
    child.stdin!.end()
    await new Promise<void>(resolve => {
      child.process.on('close', code => {
        exitCode = code ?? 0
        resolve()
      })
    })
    assert.equal(exitCode, 0)
  })
})
