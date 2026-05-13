// node --test specs for the no-meta-comments-guard hook.

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

test('non-Edit/Write tool calls pass through', async () => {
  const result = await runHook({
    tool_input: { command: 'echo // Plan: do thing' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('non-source files pass through (markdown / json / yaml)', async () => {
  for (const file_path of ['/x/docs/readme.md', '/x/package.json', '/x/.github/workflows/ci.yml']) {
    const result = await runHook({
      tool_input: { file_path, new_string: '// Plan: do the thing\nconst x = 1' },
      tool_name: 'Edit',
    })
    assert.strictEqual(result.code, 0, file_path)
  }
})

test('// Plan: prefix is blocked with strip-prefix suggestion', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/x/src/foo.ts',
      new_string: 'const x = 1\n// Plan: use the cache to avoid re-resolving\nconst y = 2',
    },
    tool_name: 'Edit',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /Plan/)
  assert.match(result.stderr, /Use the cache to avoid re-resolving/)
})

test('// Task: prefix is blocked', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/x/src/foo.mts',
      new_string: '// Task: rename foo to bar\nconst bar = 1',
    },
    tool_name: 'Edit',
  })
  assert.strictEqual(result.code, 2)
})

test('// Per the task instructions ... is blocked', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/x/src/foo.ts',
      new_string: '// Per the task instructions, swap to async\nawait foo()',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /Per the task/i)
})

test('// As requested ... is blocked', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/x/src/foo.ts',
      new_string: '// As requested, add retry\nawait retry(foo)',
    },
    tool_name: 'Edit',
  })
  assert.strictEqual(result.code, 2)
})

test('// removed X is blocked (removed-code pattern)', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/x/src/foo.ts',
      new_string: '// removed: old behavior used a Map here\nconst data = new Set()',
    },
    tool_name: 'Edit',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /removed-code/)
})

test('// previously called X is blocked', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/x/src/foo.ts',
      new_string: '// previously called fooSync; now async\nasync function foo() {}',
    },
    tool_name: 'Edit',
  })
  assert.strictEqual(result.code, 2)
})

test('// used to be sync, made async in 6.0 is blocked', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/x/src/foo.ts',
      new_string: '// used to be sync, made async in 6.0\nasync function foo() {}',
    },
    tool_name: 'Edit',
  })
  assert.strictEqual(result.code, 2)
})

test('// no longer needed because X is blocked', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/x/src/foo.ts',
      new_string: '// no longer needed because Node 26 ships this natively\nlet polyfill: unknown',
    },
    tool_name: 'Edit',
  })
  assert.strictEqual(result.code, 2)
})

test('normal explanatory comments pass through', async () => {
  for (const text of [
    '// Use the cache to avoid re-resolving on every call.\nconst cache = new Map()',
    "// Falls back to the JS impl when smol-versions isn't available.\nconst v = getSmol()",
    '// V8 inlines this when the call site is monomorphic.\nfunction hot() {}',
    "/* Multi-line block comments describing the invariant\n   are also fine. */\nfunction f() {}",
  ]) {
    const result = await runHook({
      tool_input: { file_path: '/x/src/foo.ts', new_string: text },
      tool_name: 'Edit',
    })
    assert.strictEqual(
      result.code,
      0,
      `Expected pass for: ${text.slice(0, 60)}…\n  stderr: ${result.stderr}`,
    )
  }
})

test('multiple findings in one file are all surfaced', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/x/src/foo.ts',
      new_string:
        '// Plan: use the cache\nconst x = 1\n// removed: old impl was sync\nconst y = 2',
    },
    tool_name: 'Edit',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /Plan/)
  assert.match(result.stderr, /removed-code/)
  // Both line numbers should appear in the output.
  assert.match(result.stderr, /Line 1/)
  assert.match(result.stderr, /Line 3/)
})
