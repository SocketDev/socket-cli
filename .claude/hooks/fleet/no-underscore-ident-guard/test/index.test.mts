// node --test specs for the no-underscore-ident-guard hook.

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

// Write a one-user-turn JSONL transcript carrying `userText`, return its path.
function makeTranscript(userText: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'underscore-guard-'))
  const file = path.join(dir, 'session.jsonl')
  writeFileSync(file, JSON.stringify({ role: 'user', content: userText }))
  return file
}

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

const F = '/Users/x/projects/foo/src/mod.ts'

// ─── Pass-through cases ──────────────────────────────────────────

test('non-Edit/Write tool calls pass through', async () => {
  const result = await runHook({
    tool_input: { command: 'ls' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
})

test('missing file_path passes through', async () => {
  const result = await runHook({
    tool_input: { new_string: 'const _foo = 1' },
    tool_name: 'Edit',
  })
  assert.strictEqual(result.code, 0)
})

test('non-source extensions pass through (md, json, txt)', async () => {
  for (const p of [
    '/Users/x/projects/foo/README.md',
    '/Users/x/projects/foo/package.json',
    '/Users/x/projects/foo/notes.txt',
  ]) {
    const result = await runHook({
      tool_input: { content: 'const _x = 1', file_path: p },
      tool_name: 'Write',
    })
    assert.strictEqual(result.code, 0, p)
  }
})

test('TS/JS extensions are policed (ts/tsx/js/jsx/mts/cts)', async () => {
  for (const ext of ['ts', 'tsx', 'js', 'jsx', 'mts', 'cts']) {
    const result = await runHook({
      tool_input: {
        content: 'const _foo = 1',
        file_path: `/Users/x/projects/foo/src/mod.${ext}`,
      },
      tool_name: 'Write',
    })
    assert.strictEqual(result.code, 2, `${ext} should be policed`)
  }
})

// ─── Allowlist cases ─────────────────────────────────────────────

test('_internal/ directory passes through', async () => {
  const result = await runHook({
    tool_input: {
      content: 'const _resolutionCache = new Map()',
      file_path: '/Users/x/projects/foo/src/external-tools/_internal/cache.ts',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('dist/ generated paths pass through', async () => {
  const result = await runHook({
    tool_input: {
      content: 'const _temp = 1',
      file_path: '/Users/x/projects/foo/dist/bundle.js',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('build/ generated paths pass through', async () => {
  const result = await runHook({
    tool_input: {
      content: 'const _temp = 1',
      file_path: '/Users/x/projects/foo/build/out.js',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('node_modules paths pass through', async () => {
  const result = await runHook({
    tool_input: {
      content: 'const _vendored = 1',
      file_path: '/Users/x/projects/foo/node_modules/some-dep/index.js',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('bare _ as throwaway is allowed', async () => {
  const result = await runHook({
    tool_input: {
      content: 'for (const _ of arr) { count++ }',
      file_path: F,
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('destructuring rest with _ as ignore is allowed', async () => {
  const result = await runHook({
    tool_input: {
      content: 'const { foo, ...rest } = obj\nconst { a: _, b } = pair',
      file_path: F,
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('regular identifiers without underscore prefix pass', async () => {
  const result = await runHook({
    tool_input: {
      content: `
        const resolutionCache = new Map()
        function doResolveX() {}
        export class Helper {}
        export interface Options {}
        export type Internal = string
      `,
      file_path: F,
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

// ─── Banned cases ────────────────────────────────────────────────

test('const _foo is blocked', async () => {
  const result = await runHook({
    tool_input: { content: 'const _foo = 1', file_path: F },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /_foo/)
})

test('let _bar is blocked', async () => {
  const result = await runHook({
    tool_input: { content: 'let _bar = 1', file_path: F },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
})

test('var _baz is blocked', async () => {
  const result = await runHook({
    tool_input: { content: 'var _baz = 1', file_path: F },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
})

test('function _doFoo() is blocked', async () => {
  const result = await runHook({
    tool_input: { content: 'function _doFoo() {}', file_path: F },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /_doFoo/)
})

test('async function _doFoo() is blocked', async () => {
  const result = await runHook({
    tool_input: { content: 'async function _doFoo() {}', file_path: F },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
})

test('export function _resetX() is blocked', async () => {
  const result = await runHook({
    tool_input: { content: 'export function _resetX() {}', file_path: F },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /_resetX/)
})

test('class _Helper is blocked', async () => {
  const result = await runHook({
    tool_input: { content: 'class _Helper {}', file_path: F },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
})

test('interface _Options is blocked', async () => {
  const result = await runHook({
    tool_input: { content: 'interface _Options {}', file_path: F },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
})

test('type _Internal = ... is blocked', async () => {
  const result = await runHook({
    tool_input: { content: 'type _Internal = string', file_path: F },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
})

test('export { _foo } re-export is blocked', async () => {
  const result = await runHook({
    tool_input: {
      content: "import { _foo } from 'mod'\nexport { _foo }",
      file_path: F,
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
})

test('multiple offenders are all listed in the error', async () => {
  const result = await runHook({
    tool_input: {
      content: `
        const _cache = new Map()
        function _doWork() {}
        class _Helper {}
      `,
      file_path: F,
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /_cache/)
  assert.match(result.stderr, /_doWork/)
  assert.match(result.stderr, /_Helper/)
})

test('error message points at the file and line', async () => {
  const result = await runHook({
    tool_input: { content: 'const _foo = 1', file_path: F },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /mod\.ts:1/)
})

test('error message mentions _internal/ exception + bypass phrase', async () => {
  const result = await runHook({
    tool_input: { content: 'const _foo = 1', file_path: F },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /_internal\//)
  assert.match(result.stderr, /Allow underscore-identifier bypass/)
})

// ─── Bypass case ─────────────────────────────────────────────────

test('bypass phrase in a recent transcript user turn allows the edit', async () => {
  const transcriptPath = makeTranscript('Allow underscore-identifier bypass')
  const result = await runHook({
    tool_input: { content: 'const _foo = 1', file_path: F },
    tool_name: 'Write',
    transcript_path: transcriptPath,
  })
  assert.strictEqual(result.code, 0)
})

// ─── Edge cases ──────────────────────────────────────────────────

test('malformed JSON fails open (exit 0)', async () => {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  child.stdin!.end('not-json{')
  const code = await new Promise<number>(resolve => {
    child.process.on('exit', c => resolve(c ?? 0))
  })
  assert.strictEqual(code, 0)
})

test('empty content passes through', async () => {
  const result = await runHook({
    tool_input: { content: '', file_path: F },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('Edit with new_string (not content) is checked', async () => {
  const result = await runHook({
    tool_input: { file_path: F, new_string: 'const _foo = 1' },
    tool_name: 'Edit',
  })
  assert.strictEqual(result.code, 2)
})
