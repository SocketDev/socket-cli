// Tests for options-param-naming-guard.

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

const DECL_OPTS = `export function resolve(opts?: ResolveOptions) {
  const o = { __proto__: null, ...opts }
  return o.cwd
}
`

const ARROW_OPTS = `export const resolve = (opts: ResolveOptions) => opts.cwd
`

const GOOD = `export function resolve(options?: ResolveOptions) {
  const opts = { __proto__: null, ...options } as ResolveOptions
  return opts.cwd
}
`

const ALLOW_MARKER_ABOVE = `// socket-lint: allow options-param-naming
export function legacy(opts: Whatever) {
  return opts
}
`

const DESTRUCTURED = `export function resolve({ opts }: { opts?: number }) {
  return opts
}
`

const PROPERTY_OPTS = `export function resolve(source: { opts: number }) {
  return source.opts
}
`

const TYPE_MEMBER_OPTS = `export interface Cfg {
  opts: number
}
export const x = 1
`

describe('options-param-naming-guard', () => {
  test('blocks a function declaration with an `opts` param', async () => {
    const result = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/example.ts', content: DECL_OPTS },
    })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /opts/)
    assert.match(result.stderr, /options/)
  })

  test('blocks an arrow function with an `opts` param', async () => {
    const result = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/example.mts', content: ARROW_OPTS },
    })
    assert.equal(result.code, 2)
  })

  test('passes the canonical options/opts shape', async () => {
    const result = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/example.ts', content: GOOD },
    })
    assert.equal(result.code, 0, result.stderr)
  })

  test('passes when the allow marker precedes the function', async () => {
    const result = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/example.ts', content: ALLOW_MARKER_ABOVE },
    })
    assert.equal(result.code, 0, result.stderr)
  })

  test('ignores a destructured `{ opts }` param', async () => {
    const result = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/example.ts', content: DESTRUCTURED },
    })
    assert.equal(result.code, 0, result.stderr)
  })

  test('ignores a `.opts` property name (not a param)', async () => {
    const result = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/example.ts', content: PROPERTY_OPTS },
    })
    assert.equal(result.code, 0, result.stderr)
  })

  test('ignores an `opts` type member (not a param)', async () => {
    const result = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/example.ts', content: TYPE_MEMBER_OPTS },
    })
    assert.equal(result.code, 0, result.stderr)
  })

  test('exempts .d.ts declaration files', async () => {
    const result = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/types.d.ts', content: DECL_OPTS },
    })
    assert.equal(result.code, 0, result.stderr)
  })

  test('exempts test files', async () => {
    const result = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/example.test.mts', content: DECL_OPTS },
    })
    assert.equal(result.code, 0, result.stderr)
  })

  test('exempts files under a /test/ tree', async () => {
    const result = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: '/repo/test/helpers.mts', content: DECL_OPTS },
    })
    assert.equal(result.code, 0, result.stderr)
  })

  test('ignores non-code files', async () => {
    const result = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/readme.md', content: DECL_OPTS },
    })
    assert.equal(result.code, 0, result.stderr)
  })

  test('ignores non-Edit/Write tools', async () => {
    const result = await runHook({
      tool_name: 'Bash',
      tool_input: { file_path: '/tmp/example.ts', content: DECL_OPTS },
    })
    assert.equal(result.code, 0, result.stderr)
  })

  test('fails open on a malformed payload', async () => {
    const result = await runHook('not json' as unknown as object)
    assert.equal(result.code, 0, result.stderr)
  })
})
